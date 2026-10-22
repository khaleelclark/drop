package household.share.android

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

data class Transfer(
    val id: String = UUID.randomUUID().toString(),
    var direction: String = "upload",
    var name: String = "shared-file",
    var size: Long = -1,
    var offset: Long = 0,
    var status: String = "queued",
    var error: String = "",
    var baseUrl: String = "",
    var sourceDevice: String = "Android",
    var source: String = "",
    var localPath: String = "",
    var needsStaging: Boolean = false,
    var fingerprint: String = "",
    var modified: Long = -1,
    var uploadUrl: String = "",
    var itemId: String = "",
    var kind: String = "file",
    var mime: String = "application/octet-stream",
    var etag: String = "",
    var attempts: Int = 0,
    var retryAt: Long = 0,
) {
    fun json(privateFields: Boolean = true): JSONObject = JSONObject().apply {
        put("id", id); put("direction", direction); put("name", name); put("size", size)
        put("offset", offset); put("status", status); put("itemId", itemId); if (error.isNotEmpty()) put("error", error)
        if (privateFields) {
            put("baseUrl", baseUrl); put("sourceDevice", sourceDevice); put("source", source)
            put("localPath", localPath); put("needsStaging", needsStaging); put("fingerprint", fingerprint)
            put("modified", modified); put("uploadUrl", uploadUrl); put("itemId", itemId); put("kind", kind)
            put("mime", mime); put("etag", etag); put("attempts", attempts); put("retryAt", retryAt)
        }
    }
    companion object {
        fun from(j: JSONObject) = Transfer(
            id = j.getString("id"), direction = j.optString("direction", "upload"), name = j.getString("name"),
            size = j.optLong("size", -1), offset = j.optLong("offset"), status = j.getString("status"), error = j.optString("error"),
            baseUrl = j.getString("baseUrl"), sourceDevice = j.optString("sourceDevice", "Android"), source = j.optString("source"),
            localPath = j.optString("localPath"), needsStaging = j.optBoolean("needsStaging"), fingerprint = j.optString("fingerprint"),
            modified = j.optLong("modified", -1), uploadUrl = j.optString("uploadUrl"), itemId = j.optString("itemId"),
            kind = j.optString("kind", "file"), mime = j.optString("mime", "application/octet-stream"), etag = j.optString("etag"),
            attempts = j.optInt("attempts"), retryAt = j.optLong("retryAt"),
        )
    }
}

class QueueStore private constructor(context: Context) : SQLiteOpenHelper(context, "transfers.db", null, 1) {
    init { setWriteAheadLoggingEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE queue (id TEXT PRIMARY KEY, data TEXT NOT NULL)") }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit
    @Synchronized fun all(): List<Transfer> = readableDatabase.rawQuery("SELECT data FROM queue ORDER BY rowid", null).use { c ->
        buildList { while (c.moveToNext()) add(Transfer.from(JSONObject(c.getString(0)))) }
    }
    @Synchronized fun get(id: String): Transfer? = readableDatabase.rawQuery("SELECT data FROM queue WHERE id=?", arrayOf(id)).use { c ->
        if (c.moveToFirst()) Transfer.from(JSONObject(c.getString(0))) else null
    }
    @Synchronized fun insert(t: Transfer) {
        writableDatabase.insertOrThrow("queue", null, ContentValues().apply { put("id", t.id); put("data", t.json().toString()) })
    }
    @Synchronized fun edit(id: String, mutate: (Transfer) -> Unit): Transfer {
        val t = get(id) ?: error("Transfer not found")
        mutate(t)
        writableDatabase.update("queue", ContentValues().apply { put("data", t.json().toString()) }, "id=?", arrayOf(id))
        return t
    }
    companion object {
        @Volatile private var instance: QueueStore? = null
        fun of(context: Context): QueueStore = instance ?: synchronized(this) {
            instance ?: QueueStore(context.applicationContext).also { instance = it }
        }
    }
}

class ConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    data class Config(val baseUrl: String, val token: String, val sourceDevice: String, val connected: Boolean)
    fun current(): Config = Config(prefs.getString("baseUrl", "")!!, prefs.getString("token", "")!!, prefs.getString("sourceDevice", "Android")!!, prefs.getBoolean("connected", true))
    fun sourceDevice(name: String) { require(prefs.edit().putString("sourceDevice", name.take(100)).commit()) { "Could not save device name" } }
    fun set(j: JSONObject): Config {
        val base = TransferPolicy.baseUrl(j.getString("baseUrl"), j.optBoolean("allowInsecureLoopback"))
        val token = j.optString("token")
        require(!token.contains('\r') && !token.contains('\n')) { "Invalid token" }
        val device = j.optString("sourceDevice", "Android").take(100)
        require(prefs.edit().putString("baseUrl", base).putString("token", token).putString("sourceDevice", device).putBoolean("connected", true).commit()) { "Could not save connection" }
        return current()
    }
    fun disconnect() { require(prefs.edit().remove("token").putBoolean("connected", false).commit()) { "Could not erase saved token" } }
    fun requireFor(base: String): Config = current().also { require(it.connected && it.baseUrl == base && base.isNotEmpty()) { "Reconnect to the transfer's original server to continue" } }
}
