package household.share.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

object DevicePolicy {
    private val idPattern = Regex("[0-9a-f]{32}")
    fun id(value: String): String = value.also { require(idPattern.matches(it)) { "Invalid device or item ID" } }
    fun origin(base: String): String {
        val u = URI(base)
        require(u.host != null && u.rawUserInfo == null && u.rawQuery == null && u.rawFragment == null && u.rawPath in listOf(null, "", "/")) { "Invalid paired origin" }
        val scheme = u.scheme.lowercase()
        require(scheme in setOf("https", "http")) { "Invalid paired origin" }
        val port = if (u.port == -1 || (scheme == "https" && u.port == 443) || (scheme == "http" && u.port == 80)) "" else ":${u.port}"
        return "$scheme://${u.host.lowercase()}$port"
    }
    fun key(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    fun label(value: String): String = value.also {
        require(it.isNotBlank() && it.toByteArray(Charsets.UTF_8).size <= 128 && it.none { c -> Character.isISOControl(c) }) { "Use a device name of 1–128 UTF-8 bytes without control characters" }
    }
    fun targets(args: JSONObject, source: String): List<String> {
        if (!args.has("targetDeviceIds")) return emptyList()
        val array = args.getJSONArray("targetDeviceIds")
        require(array.length() <= 64) { "Choose up to 64 devices" }
        val result = (0 until array.length()).map { i -> id(array.get(i) as? String ?: error("Device ID must be a string")) }
        if (result.isNotEmpty()) id(source)
        require(result.distinct().size == result.size && source !in result) { "Duplicate and self targets are not allowed" }
        return result.toList()
    }
}

/** The same durable store is used by UI, native intake and workers. */
class DeviceIdentity(private val read: (String) -> String?, private val write: (String, String) -> Unit) {
    fun forServer(base: String): String = synchronized(lock) {
        val key = "device.${DevicePolicy.key(DevicePolicy.origin(base))}"
        read(key)?.let { return@synchronized DevicePolicy.id(it) }
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        bytes.joinToString("") { "%02x".format(it) }.also { write(key, it) }
    }
    companion object { private val lock = Any() }
}

data class SendRouting(val baseUrl: String, val sourceDevice: String, val sourceDeviceId: String, val targetDeviceIds: List<String>) {
    fun json() = JSONObject().put("baseUrl", baseUrl).put("sourceDevice", sourceDevice).put("sourceDeviceId", sourceDeviceId).put("targetDeviceIds", JSONArray(targetDeviceIds))
    fun applyTo(t: Transfer) = t.apply {
        baseUrl = this@SendRouting.baseUrl; sourceDevice = this@SendRouting.sourceDevice
        sourceDeviceId = this@SendRouting.sourceDeviceId; targetDeviceIds = this@SendRouting.targetDeviceIds.toList()
    }
    companion object {
        fun from(j: JSONObject): SendRouting {
            val source = DevicePolicy.id(j.getString("sourceDeviceId"))
            val base = j.getString("baseUrl"); DevicePolicy.origin(base)
            return SendRouting(base, j.getString("sourceDevice"), source, DevicePolicy.targets(j, source))
        }
    }
}

/** Commit before leaving the sender/picker Activity; rows keep this snapshot after intake. */
class RoutingCaptures(context: Context) {
    private val prefs = context.getSharedPreferences("intake-routing", Context.MODE_PRIVATE)
    fun save(route: SendRouting): String = UUID.randomUUID().toString().also {
        check(prefs.edit().putString(it, route.json().toString()).commit()) { "Could not save send routing" }
    }
    fun get(id: String): SendRouting = SendRouting.from(JSONObject(prefs.getString(id, null) ?: error("Saved send routing is unavailable; select files again")))
    fun remove(id: String) { check(prefs.edit().remove(id).commit()) { "Could not clear send routing" } }
}

object DeviceRegistration {
    fun ensure(context: Context, http: NativeHttp, base: String, deviceId: String) {
        DevicePolicy.id(deviceId)
        val config = ConfigStore(context).requireFor(base)
        require(config.deviceId == deviceId) { "Reconnect the original device identity" }
        ensure(deviceId, config.sourceDevice) { body -> http.json(base, "/api/devices/register", body) }
    }
    internal fun ensure(deviceId: String, label: String, register: (JSONObject) -> JSONObject) {
        val body = JSONObject().put("id", DevicePolicy.id(deviceId)).put("label", DevicePolicy.label(label)).put("platform", "android").put("preserveExisting", true)
        val result = register(body).getJSONObject("device")
        require(result.getString("id") == deviceId && result.getString("platform") == "android") { "Server returned a different device identity" }
    }
}

class UploadCreationUnknown : IllegalStateException("Upload creation outcome is unknown. Check All shares, then cancel this row and select the source again; it will not create another item automatically.")

object UploadRouting {
    fun requireCreatable(t: Transfer) { if (t.uploadUrl.isEmpty() && t.creationPending) throw UploadCreationUnknown() }
    fun metadata(t: Transfer): Map<String, String> = linkedMapOf("filename" to t.name, "filetype" to t.mime, "kind" to t.kind, "sourceDevice" to t.sourceDevice).apply {
        if (t.sourceDeviceId.isNotEmpty()) {
            put("sourceDeviceId", DevicePolicy.id(t.sourceDeviceId))
            put("targetDeviceIds", JSONArray(DevicePolicy.targets(JSONObject().put("targetDeviceIds", JSONArray(t.targetDeviceIds)), t.sourceDeviceId)).toString())
        } else require(t.targetDeviceIds.isEmpty()) { "Targeted sends require a captured source identity" }
    }
}
