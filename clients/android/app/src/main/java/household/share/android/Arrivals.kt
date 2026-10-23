package household.share.android

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.time.Instant
import java.util.WeakHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ArrivalStore(context: Context, val config: ConfigStore.Config) {
    private val prefs = context.getSharedPreferences("zing-arrivals", Context.MODE_PRIVATE)
    val scope = ArrivalPolicy.scope(config.baseUrl, config.deviceId)
    private fun key(name: String) = "$scope.$name"
    fun enabled() = prefs.getBoolean(key("enabled"), false)
    fun enabled(value: Boolean) { check(prefs.edit().putBoolean(key("enabled"), value).commit()) { "Could not save arrival setting" } }
    fun cursor(): String? = prefs.getString(key("cursor"), null)?.also { ArrivalPolicy.cursor(it) }
    fun cursor(value: String) { ArrivalPolicy.cursor(value); check(prefs.edit().putString(key("cursor"), value).commit()) { "Could not save arrival progress" } }
    fun ready() = prefs.getLong(key("retryAt"), 0) <= System.currentTimeMillis()
    fun checked(error: String? = null) {
        val attempts = if (error == null) 0 else minOf(6, prefs.getInt(key("attempts"), 0) + 1)
        check(prefs.edit().putString(key("lastCheckedAt"), Instant.now().toString()).putInt(key("attempts"), attempts)
            .putLong(key("retryAt"), if (error == null) 0 else System.currentTimeMillis() + ArrivalPolicy.retryDelay(attempts - 1)).apply {
            if (error == null) remove(key("lastError")) else putString(key("lastError"), error)
        }.commit()) { "Could not save arrival status" }
    }
    fun settings(context: Context): JSONObject {
        val permission = ArrivalPermission.status(context)
        return JSONObject().put("enabled", enabled()).put("permission", permission).put("mode", "scheduled").apply {
            prefs.getString(key("lastCheckedAt"), null)?.let { put("lastCheckedAt", it) }
            prefs.getString(key("lastError"), null)?.let { put("lastError", it) }
            if (enabled() && permission == "denied") put("lastError", "Notifications are blocked. Enable Zing notifications and the Zing arrivals channel in Android Settings. For you remains available.")
        }
    }
    companion object {
        fun current(context: Context): ArrivalStore? {
            val c = ConfigStore(context).current()
            return if (c.baseUrl.isEmpty()) null else ArrivalStore(context, c)
        }
        fun settings(context: Context): JSONObject = current(context)?.settings(context)
            ?: JSONObject().put("enabled", false).put("permission", ArrivalPermission.status(context)).put("mode", "scheduled")
    }
}

object ArrivalNotifications {
    const val CHANNEL = "zing-arrivals"
    private const val ID = 73
    fun channel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Zing arrivals", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }
    fun post(context: Context, c: ConfigStore.Config, row: ArrivalPolicy.Entry) {
        val key = ArrivalPolicy.notificationKey(c.baseUrl, c.deviceId, row.sequence)
        val intent = Intent(context, ArrivalOpenActivity::class.java).setData(Uri.parse("zing-arrival:$key"))
            .putExtra("baseUrl", DevicePolicy.origin(c.baseUrl)).putExtra("itemId", row.itemId)
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val public = Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("Zing").setContentText("New share available").build()
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("Zing").setContentText("New share available").setContentIntent(open)
            .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public).build()
        post({ ArrivalPermission.status(context) }) {
            context.getSystemService(NotificationManager::class.java).notify(key, ID, notification)
        }
    }
    internal fun post(permission: () -> String, notify: () -> Unit) {
        check(permission() == "granted") { "Arrival notifications are not allowed" }
        notify()
    }
    fun clear(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.notification.channelId == CHANNEL }.forEach { manager.cancel(it.tag, it.id) }
    }
}

object ArrivalPermission {
    private const val REQUEST = 1204
    private val callbacks = WeakHashMap<Activity, (JSONObject) -> Unit>()
    fun status(context: Context): String {
        val runtime = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val asked = context.getSharedPreferences("zing-arrivals", Context.MODE_PRIVATE).getBoolean("permissionAsked", false)
        val manager = context.getSystemService(NotificationManager::class.java)
        val allowed = manager.getNotificationChannel(ArrivalNotifications.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        return ArrivalPolicy.permission(runtime, asked, manager.areNotificationsEnabled(), allowed)
    }
    /** Only the wrappers' explicit visible Enable path calls this; startup never prompts. */
    fun set(activity: Activity, enabled: Boolean, complete: (JSONObject) -> Unit) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val state = ArrivalStore.current(activity) ?: error("Configure Zing first")
        if (enabled) require(state.config.connected) { "Reconnect to enable arrivals" }
        ArrivalNotifications.channel(activity)
        ArrivalProcessor.flight.guard {
            state.enabled(enabled)
            ArrivalProcessor.stop()
            if (!enabled) ArrivalNotifications.clear(activity)
        }
        ArrivalScheduler.reconcile(activity)
        if (enabled && Build.VERSION.SDK_INT >= 33 && status(activity) == "prompt") {
            check(!callbacks.containsKey(activity)) { "Notification permission request is already open" }
            val prefs = activity.getSharedPreferences("zing-arrivals", Context.MODE_PRIVATE)
            check(prefs.edit().putBoolean("permissionAsked", true).commit())
            callbacks[activity] = complete
            try { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST) }
            catch (e: Exception) { callbacks.remove(activity); throw e }
        } else complete(ArrivalStore.settings(activity))
    }
    fun result(activity: Activity, request: Int): Boolean {
        if (request != REQUEST) return false
        callbacks.remove(activity)?.invoke(ArrivalStore.settings(activity))
        ArrivalScheduler.reconcile(activity)
        return true
    }
    fun destroyed(activity: Activity) { callbacks.remove(activity) }
}

object ArrivalClicks {
    private fun prefs(context: Context) = context.getSharedPreferences("zing-arrival-click", Context.MODE_PRIVATE)
    private fun store(context: Context) = ArrivalTargetStore({
        val p = prefs(context); p.getString("baseUrl", "")!! to p.getString("itemId", "")!!
    }, { value ->
        check(prefs(context).edit().clear().apply {
            if (value != null) { putString("baseUrl", value.first); putString("itemId", value.second) }
        }.commit()) { "Could not save arrival target" }
    })
    fun save(context: Context, base: String, item: String): Boolean = ArrivalProcessor.flight.guard {
        val c = ConfigStore(context).current()
        store(context).save(c.baseUrl, c.connected, base, item)
    }
    fun take(context: Context): Any = ArrivalProcessor.flight.guard {
        val c = ConfigStore(context).current()
        store(context).take(c.baseUrl, c.connected)?.let { JSONObject().put("baseUrl", it.first).put("itemId", it.second) } ?: JSONObject.NULL
    }
    fun clear(context: Context) { check(prefs(context).edit().clear().commit()) }
}

/** An explicit immutable notification action persists its target before the UI launches. */
class ArrivalOpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching {
            if (ArrivalClicks.save(this, intent.getStringExtra("baseUrl").orEmpty(), intent.getStringExtra("itemId").orEmpty())) {
                packageManager.getLaunchIntentForPackage(packageName)?.let {
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    startActivity(it)
                }
            }
        }
        finish()
    }
}

object ArrivalProcessor {
    val flight = ArrivalFlight()
    private val executor = Executors.newSingleThreadExecutor()
    fun stop() = flight.stop()
    fun start(context: Context, finished: (ArrivalFlight.Ticket) -> Unit = {}): ArrivalFlight.Ticket? {
        val app = context.applicationContext
        val state = ArrivalStore.current(app) ?: return null
        if (!state.config.connected || !ArrivalPolicy.canCheck(state.enabled(), ArrivalPermission.status(app)) || !state.ready()) return null
        val ticket = flight.begin() ?: return null
        executor.execute {
            val http = NativeHttp(app, 20)
            ticket.cancelIo = { http.cancel() }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(70)
            fun checkRun() {
                ticket.check()
                check(System.nanoTime() < deadline) { "Arrival check time budget reached" }
                val c = ConfigStore(app).current()
                check(c.connected && c.baseUrl == state.config.baseUrl && c.deviceId == state.config.deviceId && state.enabled()) { "Arrival pairing changed" }
                check(ArrivalPolicy.canCheck(state.enabled(), ArrivalPermission.status(app))) { "Arrival notifications are not allowed" }
            }
            try {
                checkRun()
                DeviceRegistration.ensure(app, http, state.config.baseUrl, state.config.deviceId)
                var cursor = state.cursor()
                // Retry a lost ACK using only already-processed, persisted server-issued progress.
                fun ack(value: String) {
                    checkRun()
                    val result = http.json(state.config.baseUrl, "/api/devices/${state.config.deviceId}/notifications/ack", JSONObject().put("through", value))
                    require(ArrivalPolicy.cursor(result.get("ackCursor") as? String ?: error("Invalid ACK")) >= ArrivalPolicy.cursor(value)) { "ACK moved backward" }
                }
                if (cursor != null) ack(cursor)
                for (pageIndex in 0 until 4) {
                    checkRun()
                    val suffix = if (cursor == null) "?limit=50" else "?limit=50&after=$cursor"
                    val page = ArrivalPolicy.page(http.json(state.config.baseUrl, "/api/devices/${state.config.deviceId}/notifications$suffix"), cursor)
                    ArrivalPolicy.process(page, cursor, { row ->
                        flight.current(ticket) { checkRun(); ArrivalNotifications.post(app, state.config, row) }
                    }, { value -> flight.current(ticket) { checkRun(); state.cursor(value) } }, ::ack)
                    cursor = page.next
                    if (!page.more) break
                }
                checkRun(); state.checked()
            } catch (_: Exception) {
                // No credential, URL, content or arbitrary remote error is copied into settings.
                runCatching {
                    ticket.check()
                    if (ArrivalPolicy.canCheck(state.enabled(), ArrivalPermission.status(app)))
                        state.checked("Could not check arrivals. Confirm the connection and reopen Zing to retry.")
                }
            } finally {
                flight.finish(ticket)
                Handler(Looper.getMainLooper()).post { finished(ticket) }
            }
        }
        return ticket
    }
}

object ArrivalScheduler {
    private const val JOB = 74
    private val handler = Handler(Looper.getMainLooper())
    private val visible = mutableSetOf<Any>()
    private var application: Application? = null
    private val poll = object : Runnable {
        override fun run() {
            if (visible.isEmpty()) return
            val app = application ?: return
            val state = ArrivalStore.current(app) ?: return
            if (!state.config.connected || !state.enabled()) return
            ArrivalProcessor.start(app)
            handler.postDelayed(this, 5_000)
        }
    }
    fun visible(context: Context, owner: Any, resumed: Boolean) {
        check(Looper.myLooper() == Looper.getMainLooper())
        this.application = context.applicationContext as Application
        if (resumed) visible.add(owner) else visible.remove(owner)
        handler.removeCallbacks(poll)
        if (visible.isNotEmpty()) handler.post(poll) else ArrivalProcessor.stop()
        if (resumed) reconcile(context)
    }
    fun reconcile(context: Context) {
        handler.post {
            handler.removeCallbacks(poll)
            if (visible.isNotEmpty()) handler.post(poll)
        }
        val state = ArrivalStore.current(context)
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (state == null || !state.config.connected || !ArrivalPolicy.canCheck(state.enabled(), ArrivalPermission.status(context))) {
            scheduler.cancel(JOB); return
        }
        // shortcut: job is not persisted across reboot; reopening Zing schedules it again.
        if (scheduler.getPendingJob(JOB) == null) {
            val job = JobInfo.Builder(JOB, ComponentName(context, ArrivalJobService::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60_000L)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()
            if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) state.checked("Android could not schedule arrivals. Reopen Zing to retry.")
        }
    }
    fun disconnected(context: Context) {
        ArrivalProcessor.stop()
        context.getSystemService(JobScheduler::class.java).cancel(JOB)
        ArrivalNotifications.clear(context); ArrivalClicks.clear(context)
    }
}

class ArrivalJobService : JobService() {
    private var run: ArrivalFlight.Ticket? = null
    override fun onStartJob(params: JobParameters): Boolean {
        run = ArrivalProcessor.start(this) { completed ->
            if (run === completed) { run = null; jobFinished(params, false) }
        }
        return run != null
    }
    override fun onStopJob(params: JobParameters): Boolean { run?.cancel(); run = null; return true }
    override fun onDestroy() { run?.cancel(); run = null; super.onDestroy() }
}
