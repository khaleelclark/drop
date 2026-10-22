package household.share.android

import android.content.Context
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.UUID

class HttpFailure(val status: Int, message: String) : IOException(message)

class NativeHttp(private val context: Context) {
    private val epoch = ApiCalls.epoch()
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
    @Volatile var active: Call? = null
    fun request(t: Transfer, url: String): Request.Builder {
        val config = ConfigStore(context).requireFor(t.baseUrl)
        require(url.startsWith(t.baseUrl + "/api/")) { "Request is outside the configured API" }
        return Request.Builder().url(url).apply { if (config.token.isNotEmpty()) header("Authorization", "Bearer ${config.token}") }
            .header("Accept-Encoding", "identity")
    }
    fun execute(request: Request): Response {
        if (epoch != ApiCalls.epoch()) throw IOException("Disconnected")
        return client.newCall(request).also { active = it }.execute()
    }
    fun checked(response: Response, vararg allowed: Int): Response {
        if (response.code !in allowed) {
            // Read no unbounded error body or credentials into persistent error messages.
            val code = response.code
            response.close()
            throw HttpFailure(code, "Server returned HTTP $code")
        }
        return response
    }
    fun chunk(t: Transfer, source: SourceAccess, offset: Long, length: Long, check: () -> Unit) = object : RequestBody() {
        override fun contentType() = "application/offset+octet-stream".toMediaType()
        override fun contentLength() = length
        override fun writeTo(sink: BufferedSink) {
            val buffer = ByteArray(TransferPolicy.BUFFER)
            var remaining = length
            source.open(t, offset).use { input ->
                while (remaining > 0) {
                    check()
                    val n = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                    if (n < 0) throw SourceChanged()
                    sink.write(buffer, 0, n)
                    remaining -= n
                }
            }
        }
    }

    fun api(args: JSONObject): JSONObject {
        val c = ConfigStore(context).current()
        val path = args.getString("path")
        require(path.startsWith("/api/") && !path.contains("..") && !path.contains('#') && !path.contains('\\')) { "API path required" }
        require(!Regex("/api/(uploads|items/[^/]+/download)").containsMatchIn(path)) { "Use native transfer commands for file bytes" }
        require(!path.startsWith("/api/events")) { "Use bounded feed polling in the native shell" }
        val method = args.optString("method", "GET").uppercase()
        require(method in setOf("GET", "POST", "PATCH", "DELETE", "HEAD")) { "Unsupported method" }
        val bodyText = if (args.has("body") && !args.isNull("body")) {
            val body = args.get("body")
            if (body is String) body else body.toString()
        } else ""
        require(bodyText.toByteArray(Charsets.UTF_8).size <= 40 * 1024 * 1024) { "Use a text file for larger text" }
        val body = if (method in setOf("POST", "PATCH")) object : RequestBody() {
            override fun contentType() = "application/json".toMediaType()
            override fun writeTo(sink: BufferedSink) { sink.writeUtf8(bodyText) }
        } else null
        val req = request(Transfer(baseUrl = c.baseUrl), c.baseUrl + path).method(method, body).build()
        val requestId = args.optString("requestId").ifBlank { UUID.randomUUID().toString() }
        val call = client.newCall(req)
        ApiCalls.register(requestId, call, epoch)
        try {
            call.execute().use { r ->
            val limit = if (Regex("/api/items/[^/]+/text(?:\\?.*)?").matches(path)) TransferPolicy.COPY_LIMIT.toLong() else TransferPolicy.METADATA_LIMIT.toLong()
            val content = r.body
            require(content == null || content.contentLength() <= limit) { "Response exceeds the client preparation budget; download the full text as a file" }
            val buffer = okio.Buffer()
            content?.source()?.let { input ->
                while (!input.exhausted() && buffer.size <= limit) {
                    input.read(buffer, minOf(TransferPolicy.BUFFER.toLong(), limit + 1 - buffer.size))
                }
            }
            val bytes = buffer.readByteArray()
            require(bytes.size <= limit) { "Response exceeds the client preparation budget; download the full text as a file" }
            return JSONObject().put("status", r.code).put("body", bytes.toString(Charsets.UTF_8)).put("headers", JSONObject().apply {
                r.headers.forEach { (name, value) -> if (!name.equals("Set-Cookie", true)) put(name, value) }
            })
            }
        } finally {
            ApiCalls.finish(requestId, call)
        }
    }
    companion object {
        fun cancelApi(id: String) = ApiCalls.cancel(id)
        fun cancelAllApi() = ApiCalls.cancelAll()
    }
}
