package household.share.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PersistableBundle
import android.os.PowerManager
import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

object TransferNotifications {
    private const val CHANNEL = "household-transfers"
    fun id(t: Transfer) = t.id.hashCode().and(0x3fffffff) + 100
    fun notification(context: Context, t: Transfer): Notification {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Household transfers", NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(context, id(t), Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        fun control(action: String): PendingIntent = if (action == "resume") {
            PendingIntent.getActivity(context, id(t) + 1, Intent(context, MainActivity::class.java).putExtra("transferId", t.id).putExtra("transferAction", action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else PendingIntent.getBroadcast(context, id(t) + if (action == "pause") 2 else 3,
            Intent(context, TransferControlReceiver::class.java).setAction(action).putExtra("id", t.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val ongoing = t.status in setOf("queued", "running", "staging", "hashing", "exporting", "retry_wait", "validating", "cancelling")
        val text = if (t.error.isNotEmpty()) t.error else "${t.status}: ${t.offset.coerceAtLeast(0)} / ${t.size.coerceAtLeast(0)} bytes"
        val builder = Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(t.name).setContentText(text).setContentIntent(open).setOngoing(ongoing).setOnlyAlertOnce(true)
            .setProgress(1000, if (t.size > 0) (t.offset * 1000 / t.size).toInt() else 0, t.size < 0 || t.status in setOf("hashing", "staging", "exporting", "validating"))
        if (t.status !in setOf("completed", "cancelled")) {
            builder.addAction(Notification.Action.Builder(null, if (ongoing) "Pause" else "Resume", control(if (ongoing) "pause" else "resume")).build())
                .addAction(Notification.Action.Builder(null, "Cancel", control("cancel")).build())
        } else builder.setAutoCancel(true)
        return builder.build()
    }
    fun update(context: Context, t: Transfer) {
        try { context.getSystemService(NotificationManager::class.java).notify(id(t), notification(context, t)) }
        catch (_: SecurityException) { /* UIDT's required notification is still supplied through setNotification. */ }
    }
}

object TransferScheduler {
    /** Call only from a visible Activity, including an explicit notification Resume. */
    fun startVisible(context: Context, transfers: List<Transfer>) {
        if (!ConfigStore(context).current().connected) return
        val scheduler = context.getSystemService(JobScheduler::class.java)
        val store = QueueStore.of(context)
        val recovered = transfers.map { t ->
            val worker = TransferEngine.isActive(t.id) || TransferJobService.active.containsKey(t.id)
            val osJob = Build.VERSION.SDK_INT >= 34 && scheduler.getPendingJob(TransferNotifications.id(t)) != null
            if (TransferPolicy.recoverInterrupted(t.status, worker, osJob)) store.edit(t.id) {
                // Recheck under the store lock: an explicit Pause/Cancel must win.
                if (TransferPolicy.recoverInterrupted(it.status, worker, osJob)) { it.status = "queued"; it.retryAt = 0 }
            } else t
        }
        val pending = recovered.filter { it.status in setOf("queued", "retry_wait", "validating", "cancelling") }
        if (pending.isEmpty()) return
        if (Build.VERSION.SDK_INT >= 34) {
            pending.forEach { t ->
                val jobId = TransferNotifications.id(t)
                // Do not replace a running job just because the UI was reopened.
                if (scheduler.getPendingJob(jobId) != null) return@forEach
                val extras = PersistableBundle().apply { putString("id", t.id) }
                val estimate = TransferPolicy.networkEstimate(t.size, t.offset)
                val b = JobInfo.Builder(jobId, ComponentName(context, TransferJobService::class.java))
                    .setExtras(extras).setUserInitiated(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setEstimatedNetworkBytes(if (t.direction == "download") estimate.bytes else 0,
                        if (t.direction == "upload") estimate.bytes else 0)
                    .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                estimate.minimumChunkBytes?.let { b.setMinimumNetworkChunkBytes(it) }
                if (t.source.startsWith("content:")) {
                    b.setClipData(ClipData.newRawUri("Transfer source", Uri.parse(t.source)),
                        if (t.direction == "download") Intent.FLAG_GRANT_WRITE_URI_PERMISSION else Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                // setClipData cannot be combined with setPersisted. Queue is durable; user reopens after reboot.
                require(scheduler.schedule(b.build()) == JobScheduler.RESULT_SUCCESS) { "Android could not schedule the user-initiated transfer; keep the app visible and retry" }
            }
        } else {
            context.startForegroundService(Intent(context, LegacyTransferService::class.java))
        }
    }

    fun control(context: Context, id: String, action: String): Transfer {
        require(action in setOf("pause", "resume", "cancel")) { "Unknown transfer action" }
        val store = QueueStore.of(context)
        val t = store.edit(id) {
            require(it.status != "completed") { "Transfer already completed" }
            when (action) {
                "pause" -> if (it.status !in setOf("cancelled", "cancelling")) it.status = "paused"
                "cancel" -> it.status = "cancelling"
                "resume" -> {
                    require(it.status != "cancelled") { "Transfer was cancelled" }
                    if (it.status != "cancelling") it.status = "queued"
                    it.retryAt = 0; it.attempts = 0; it.error = ""
                }
            }
        }
        if (action != "resume") {
            TransferJobService.active[id]?.stop()
            // A stopped running job will finish gracefully; pending jobs can be cancelled immediately.
            if (Build.VERSION.SDK_INT >= 34 && !TransferJobService.active.containsKey(id)) {
                context.getSystemService(JobScheduler::class.java).cancel(TransferNotifications.id(t))
            }
        }
        TransferNotifications.update(context, t)
        return t
    }

    fun disconnect(context: Context) {
        val store = QueueStore.of(context)
        store.all().filter { it.status !in setOf("completed", "cancelled", "paused", "error", "needs_source") }.forEach { t ->
            store.edit(t.id) { it.status = "paused"; it.error = "Disconnected. Reconnect to the original server to resume." }.also { TransferNotifications.update(context, it) }
        }
        ConfigStore(context).disconnect()
        NativeHttp.cancelAllApi()
        TransferJobService.active.values.forEach { it.stop() }
        context.getSystemService(JobScheduler::class.java).cancelAll()
        context.stopService(Intent(context, LegacyTransferService::class.java))
    }
}

class TransferControlReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching {
            val id = intent.getStringExtra("id") ?: return
            val t = TransferScheduler.control(context, id, intent.action.orEmpty())
            // Pause/cancel is allowed here; Resume always launches a visible Activity.
            if (t.status == "cancelling") TransferNotifications.update(context, t.apply { error = "Open app to finish cancellation" })
        }
    }
}

class TransferJobService : JobService() {
    private val executor = Executors.newCachedThreadPool()
    override fun onStartJob(params: JobParameters): Boolean {
        val id = params.extras.getString("id") ?: return false
        val t = QueueStore.of(this).get(id) ?: return false
        if (Build.VERSION.SDK_INT >= 34) setNotification(params, TransferNotifications.id(t), TransferNotifications.notification(this, t), JOB_END_NOTIFICATION_POLICY_DETACH)
        var estimatedSize = t.size
        val engine = TransferEngine(this) { current ->
            if (Build.VERSION.SDK_INT >= 34 && current.size >= 0 && estimatedSize != current.size) {
                estimatedSize = current.size
                val bytes = maxOf(1, current.size - t.offset)
                updateEstimatedNetworkBytes(params, if (current.direction == "download") bytes else 0, if (current.direction == "upload") bytes else 0)
            }
            TransferNotifications.update(this, current)
        }
        active[id] = engine
        executor.execute {
            val retry = engine.run(id)
            // onStopJob owns rescheduling after stop. Never finish a stale JobParameters afterward.
            if (active.remove(id, engine)) jobFinished(params, retry)
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        val id = params.extras.getString("id") ?: return false
        active.remove(id)?.stop()
        return QueueStore.of(this).get(id)?.status in setOf("queued", "running", "retry_wait", "validating", "hashing", "staging", "exporting", "cancelling")
    }
    override fun onDestroy() { active.values.forEach { it.stop() }; active.clear(); executor.shutdown(); super.onDestroy() }
    companion object { val active = ConcurrentHashMap<String, TransferEngine>() }
}

/** API26-33 only: visible-started foreground service. Modern Android uses UIDT instead. */
class LegacyTransferService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var engine: TransferEngine? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var latestStartId = 0
    private var destroyed = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        val t = QueueStore.of(this).all().firstOrNull { it.status in setOf("queued", "retry_wait", "validating", "cancelling") }
        if (t == null) { if (engine == null) stopSelfResult(startId); return START_NOT_STICKY }
        startForeground(TransferNotifications.id(t), TransferNotifications.notification(this, t))
        if (engine != null) return START_NOT_STICKY
        if (wakeLock == null) wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HouseholdShare:Transfer").apply {
            setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L)
        }
        startEngine()
        return START_NOT_STICKY
    }
    /** Engine completion and new start commands are serialized on the main thread. */
    private fun startEngine() {
        if (destroyed || engine != null) return
        main.removeCallbacksAndMessages(null)
        val current = TransferEngine(this) {
            wakeLock?.acquire(6 * 60 * 60 * 1000L)
            TransferNotifications.update(this, it)
        }
        engine = current
        executor.execute {
            current.run()
            main.post {
                if (destroyed || engine !== current) return@post
                engine = null
                val rows = QueueStore.of(this).all()
                val now = System.currentTimeMillis()
                // Include work enqueued after run() took its initial snapshot.
                if (rows.any { TransferPolicy.runnableNow(it.status, it.retryAt, now) }) { startEngine(); return@post }
                val validation = rows.filter { it.status == "validating" }.minOfOrNull { it.retryAt }
                if (validation != null) {
                    main.postDelayed({ startEngine() }, maxOf(1000L, validation - now))
                    return@post
                }
                // Network retries on older Android require renewed visible initiation.
                rows.filter { it.status == "retry_wait" }.forEach {
                    QueueStore.of(this).edit(it.id) { t -> t.error = "Connection interrupted. Open app or tap Resume to continue." }.also { t -> TransferNotifications.update(this, t) }
                }
                stopSelfResult(latestStartId)
            }
        }
    }
    override fun onTimeout(startId: Int, fgsType: Int) { engine?.stop(); stopSelf() }
    override fun onDestroy() { destroyed = true; main.removeCallbacksAndMessages(null); engine?.stop(); wakeLock?.let { if (it.isHeld) it.release() }; executor.shutdown(); super.onDestroy() }
}
