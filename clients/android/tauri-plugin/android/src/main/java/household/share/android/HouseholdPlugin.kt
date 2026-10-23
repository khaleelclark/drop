package household.share.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.LifecycleOwner
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** Tauri transports command metadata only. The same SQLite/JobService engine owns transfers. */
@TauriPlugin
class HouseholdPlugin(private val activity: Activity) : app.tauri.plugin.Plugin(activity) {
    private val executor = Executors.newFixedThreadPool(2)
    private var foreground: ResumedActivityGate? = null

    override fun load(webView: WebView) {
        activity.runOnUiThread {
            AppWebViewPolicy.apply(webView)
            foreground?.close()
            // Tauri can load a plugin after Activity.onResume. Lifecycle observers catch up
            // immediately and currentState remains authoritative for each later UI operation.
            foreground = ResumedActivityGate((activity as LifecycleOwner).lifecycle, onResumed = {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    AppWebViewPolicy.refreshKeyboardVisibility(webView)
                    ArrivalScheduler.visible(activity, this, true)
                    runCatching { TransferScheduler.startVisible(activity, QueueStore.of(activity).all()) }
                }
            }, onPaused = { ArrivalScheduler.visible(activity, this, false) })
        }
    }

    private fun requireVisible(message: String) {
        check(!activity.isFinishing && !activity.isDestroyed) { message }
        (foreground ?: error(message)).requireResumed(message)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        if (activity === this.activity) { foreground?.close(); executor.shutdown() }
    }

    @Command fun dispatch(invoke: Invoke) {
        val raw = invoke.getArgs()
        val command = raw.getString("command")
        val args = try {
            val encoded = raw.getString("argsJson")
            require(encoded.length <= 40 * 1024 * 1024) { "Command exceeds the client request budget" }
            JSONObject(encoded)
        } catch (e: Exception) { invoke.reject("Invalid or oversized command arguments"); return }
        if (command == "native_cancel_api") {
            runCatching { NativeHttp.cancelApi(args.getString("requestId")); invoke.resolve() }.onFailure { invoke.reject(it.message) }
            return
        }
        if (command == "native_disconnect") NativeHttp.cancelAllApi()
        executor.execute {
            runCatching {
                val store = QueueStore.of(activity)
                fun resolve(result: Any) { if (result === JSONObject.NULL) invoke.resolve() else invoke.resolveObject(result) }
                fun picker() = activity.runOnUiThread {
                    runCatching {
                        requireVisible("Open the app to use the native picker")
                        PickerHandoff.open(activity, command, args) { ok, result -> if (ok) resolve(result) else invoke.reject(result.toString()) }
                    }.onFailure { invoke.reject(it.message) }
                }
                when (command) {
                    "native_get_config", "native_configure" -> {
                        if (command == "native_configure") { ArrivalProcessor.stop(); ArrivalClicks.clear(activity) }
                        val c = if (command == "native_configure") ConfigStore(activity).set(args) else ConfigStore(activity).current()
                        if (command == "native_configure") ArrivalScheduler.reconcile(activity)
                        resolve(c.redacted())
                    }
                    "native_disconnect" -> { TransferScheduler.disconnect(activity); invoke.resolve() }
                    "native_list_transfers" -> resolve(JSONArray(store.all().map { it.json(false) }))
                    "native_api" -> resolve(NativeHttp(activity).api(args))
                    "native_pick_uploads", "native_enqueue_upload", "native_download" -> picker()
                    "native_control" -> {
                        val t = store.get(args.getString("id")) ?: error("Transfer not found")
                        val action = args.getString("action")
                        if (action == "resume" && t.status == "needs_source") picker() else {
                            activity.runOnUiThread {
                                runCatching {
                                    val changed = TransferControlCommand.run(action,
                                        requireVisible = { requireVisible("Open the app to resume") },
                                        change = { TransferScheduler.control(activity, t.id, action) },
                                        schedule = { TransferScheduler.startVisible(activity, listOf(it)) })
                                    resolve(changed.json(false))
                                }.onFailure { invoke.reject(it.message) }
                            }
                        }
                    }
                    "native_get_arrival_settings" -> resolve(ArrivalStore.settings(activity))
                    "native_take_arrival_target" -> resolve(ArrivalClicks.take(activity))
                    "native_set_arrival_enabled" -> activity.runOnUiThread {
                        runCatching {
                            val enabled = args.getBoolean("enabled")
                            ArrivalPolicy.control(enabled, { requireVisible("Open Zing to enable arrivals") }) {
                                ArrivalPermission.set(activity, enabled, ::resolve)
                            }
                        }.onFailure { invoke.reject(it.message) }
                    }
                    "native_copy_text" -> {
                        val text = args.getString("text")
                        require(text.toByteArray(Charsets.UTF_8).size <= TransferPolicy.COPY_LIMIT) { "Clipboard limit is 8 MiB; download the full text instead" }
                        activity.runOnUiThread {
                            runCatching {
                                requireVisible("Open the app to copy")
                                activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Zing text", text))
                                resolve(JSONObject().put("ok", true))
                            }.onFailure { invoke.reject(it.message) }
                        }
                    }
                    else -> error("Unsupported native command")
                }
            }.onFailure { invoke.reject(it.message) }
        }
    }
}
