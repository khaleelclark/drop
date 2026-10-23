package household.share.android

import android.app.Activity
import android.content.Intent
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Tauri uses the same native picker/intake Activity; callbacks carry only metadata. */
object PickerHandoff {
    private val routes = ConcurrentHashMap<String, String>()
    fun route(id: String): String? = routes[id]
    private val callbacks = ConcurrentHashMap<String, (Boolean, Any) -> Unit>()
    fun authorized(id: String) = callbacks.containsKey(id)
    fun open(activity: Activity, command: String, args: JSONObject, callback: (Boolean, Any) -> Unit) {
        val id = "picker-${UUID.randomUUID()}"
        if (command in setOf("native_pick_uploads", "native_enqueue_upload")) {
            if (args.has("sourceDevice")) ConfigStore(activity).sourceDevice(args.getString("sourceDevice"))
            routes[id] = RoutingCaptures(activity).save(ConfigStore(activity).capture(args))
        }
        callbacks[id] = callback
        try {
            activity.startActivity(Intent(activity, MainActivity::class.java).putExtra("nativeHandoffId", id)
                .putExtra("nativeHandoffCommand", command).putExtra("nativeHandoffArgs", args.toString()))
        } catch (e: Exception) {
            callbacks.remove(id); routes.remove(id)?.let { RoutingCaptures(activity).remove(it) }; throw e
        }
    }
    fun complete(id: String, success: Boolean, result: Any): Boolean {
        val callback = callbacks.remove(id) ?: return false
        routes.remove(id)
        callback(success, result)
        return true
    }
}
