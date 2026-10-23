package household.share.android

import android.content.Context
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class HttpFailure(val status: Int, message: String) : IOException(message)

class NativeHttp(private val context: Context, boundedCallSeconds: Long = 0) {
    private val epoch = ApiCalls.epoch()
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(30, TimeUnit.SECONDS)
        .callTimeout(boundedCallSeconds, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
    @Volatile var active: Call? = null
    private val cancelled = AtomicBoolean(false)
    fun cancel() { cancelled.set(true); active?.cancel() }
    fun request(t: Transfer, url: String): Request.Builder {
        val config = ConfigStore(context).requireFor(t.baseUrl)
        require(url.startsWith(t.baseUrl + "/api/")) { "Request is outside the configured API" }
        return Request.Builder().url(url).apply { if (config.token.isNotEmpty()) header("Authorization", "Bearer ${config.token}") }
            .header("Accept-Encoding", "identity")
    }
    fun execute(request: Request): Response {
        if (epoch != ApiCalls.epoch()) throw IOException("Disconnected")
        return client.newCall(request).also { active = it; if (cancelled.get()) it.cancel() }.execute()
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

    /** Small worker requests use the same paired-origin authentication and bounded reader. */
    fun json(base: String, path: String, body: JSONObject? = null): JSONObject {
        require(path.startsWith("/api/") && !path.contains("..") && !path.contains('#') && !path.contains('\\'))
        val request = request(Transfer(baseUrl = base), base + path).apply {
            if (body == null) get() else post(body.toString().toRequestBody("application/json".toMediaType()))
        }.build()
        checked(execute(request), 200).use { r ->
            val source = r.body?.source() ?: error("Missing server response")
            val buffer = okio.Buffer()
            require(r.body!!.contentLength() <= TransferPolicy.METADATA_LIMIT) { "Response exceeds metadata budget" }
            while (!source.exhausted() && buffer.size <= TransferPolicy.METADATA_LIMIT) {
                source.read(buffer, minOf(TransferPolicy.BUFFER.toLong(), TransferPolicy.METADATA_LIMIT + 1L - buffer.size))
            }
            require(buffer.size <= TransferPolicy.METADATA_LIMIT) { "Response exceeds metadata budget" }
            return JSONObject(buffer.readUtf8())
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
            return JSONObject().put("status", r.code).put("body", decodeUtf8(bytes)).put("headers", JSONObject().apply {
                r.headers.forEach { (name, value) -> if (!name.equals("Set-Cookie", true)) put(name, value) }
            })
            }
        } finally {
            ApiCalls.finish(requestId, call)
        }
    }
    companion object {
        internal fun decodeUtf8(bytes: ByteArray): String = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (e: CharacterCodingException) {
            throw IllegalArgumentException("Response is not valid UTF-8; download the file instead", e)
        }
        fun cancelApi(id: String) = ApiCalls.cancel(id)
        fun cancelAllApi() = ApiCalls.cancelAll()
    }
}
