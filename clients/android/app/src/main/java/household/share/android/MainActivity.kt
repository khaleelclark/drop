package household.share.android

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val executor = Executors.newSingleThreadExecutor()
    private val store by lazy { QueueStore.of(this) }
    private var pending: Pending? = null
    private var visible = false
    private var waitingShare: Intent? = null
    private var handoff: Triple<String, String, String>? = null
    private data class Pending(val requestId: String?, val type: String, val args: JSONObject = JSONObject())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
        }
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false
        }
        WebView.setWebContentsDebuggingEnabled(false)
        web.addJavascriptInterface(Bridge(), "HouseholdBridge")
        val loader = WebViewAssetLoader.Builder().addPathHandler("/", WebViewAssetLoader.PathHandler { raw ->
            val path = raw.ifBlank { "index.html" }
            if (path.contains("..") || path.contains('\\')) return@PathHandler blocked()
            try {
                val mime = when {
                    path.endsWith(".html") -> "text/html"
                    path.endsWith(".js") -> "text/javascript"
                    path.endsWith(".css") -> "text/css"
                    path.endsWith(".svg") -> "image/svg+xml"
                    path.endsWith(".png") -> "image/png"
                    path.endsWith(".json") -> "application/json"
                    path.endsWith(".webmanifest") -> "application/manifest+json"
                    else -> "application/octet-stream"
                }
                val input = if (path == "index.html") {
                    val html = assets.open("web/index.html").bufferedReader().use { it.readText() }
                    val config = ConfigStore(this).current()
                    val publicConfig = JSONObject().put("baseUrl", config.baseUrl).put("sourceDevice", config.sourceDevice).put("connected", config.connected)
                    val encoded = android.util.Base64.encodeToString(publicConfig.toString().toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
                    // Base64 keeps arbitrary user device labels out of the HTML script syntax.
                    val configScript = "window.__HOUSEHOLD_CONFIG__=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('$encoded'),c=>c.charCodeAt(0))));"
                    ByteArrayInputStream(html.replaceFirst("<head>", "<head><script>$BOOTSTRAP\n$configScript</script>").toByteArray(Charsets.UTF_8))
                } else assets.open("web/$path")
                WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf(
                    "Content-Security-Policy" to "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
                    "X-Content-Type-Options" to "nosniff",
                ), input)
            } catch (_: Exception) { blocked() }
        }).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.url.scheme != "https" || request.url.host != "appassets.androidplatform.net") return blocked()
                return loader.shouldInterceptRequest(request.url) ?: blocked()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Only packaged files may execute inside the privileged WebView. External links leave the app.
                if (request.url.scheme == "https" && request.url.host == "appassets.androidplatform.net") return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme in setOf("https", "http")) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // Onboarding may be needed before an incoming share can be accepted.
                maybeHandleShare()
            }
        }
        web.webChromeClient = WebChromeClient()
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/index.html")
        acceptIntent(intent)
    }

    override fun onResume() {
        super.onResume(); visible = true
        // Reopening the app is renewed user initiation after reboot or explicit system/user interruption.
        runCatching { TransferScheduler.startVisible(this, store.all()) }.onFailure { toast(it.message.orEmpty()) }
        handoff?.let { (id, command, args) -> handoff = null; Bridge().request(id, command, args) }
        maybeHandleShare()
    }
    override fun onPause() { visible = false; super.onPause() }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); acceptIntent(intent); maybeHandleShare()
        if (visible) runCatching { TransferScheduler.startVisible(this, store.all()) }.onFailure { toast(it.message.orEmpty()) }
    }
    override fun onDestroy() { web.removeJavascriptInterface("HouseholdBridge"); web.destroy(); executor.shutdown(); super.onDestroy() }

    private fun acceptIntent(incoming: Intent) {
        if (incoming.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) waitingShare = incoming
        incoming.getStringExtra("nativeHandoffId")?.let { id ->
            // This Activity is exported for Android Share; internal commands require a live unguessable handoff.
            if (!PickerHandoff.authorized(id)) return@let
            val command = incoming.getStringExtra("nativeHandoffCommand").orEmpty()
            require(command in setOf("native_pick_uploads", "native_enqueue_upload", "native_download", "native_control")) { "Invalid native picker command" }
            handoff = Triple(id, command, incoming.getStringExtra("nativeHandoffArgs") ?: "{}")
        }
        val id = incoming.getStringExtra("transferId")
        if (id != null && incoming.getStringExtra("transferAction") == "resume") {
            runCatching { TransferScheduler.control(this, id, "resume") }.onFailure { toast(it.message.orEmpty()) }
        }
    }

    private fun maybeHandleShare() {
        val shared = waitingShare ?: return
        if (!visible || ConfigStore(this).current().baseUrl.isEmpty()) return
        waitingShare = null
        val uris = mutableListOf<Uri>()
        if (shared.action == Intent.ACTION_SEND_MULTIPLE) {
            @Suppress("DEPRECATION") val list = shared.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            list?.let(uris::addAll)
        } else {
            @Suppress("DEPRECATION") val uri = shared.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (uri != null) uris.add(uri)
        }
        // ClipData can contain share URIs when EXTRA_STREAM is absent.
        if (uris.isEmpty()) shared.clipData?.let { c -> for (i in 0 until c.itemCount) c.getItemAt(i).uri?.let(uris::add) }
        if (uris.isNotEmpty()) intake(uris.distinct(), shared.flags, null)
        else shared.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.let { text ->
            if (text.isNotEmpty()) enqueueText(text)
        }
    }

    private fun enqueueText(text: String) {
        // Intent text is already bounded by Android Binder; keep it off bridge/feed JSON anyway.
        executor.execute {
            runCatching {
                val c = configured()
                val t = Transfer(baseUrl = c.baseUrl, sourceDevice = c.sourceDevice, kind = "text", mime = "text/plain", name = "Shared text.txt")
                val dir = File(filesDir, "staged").apply { mkdirs() }
                val file = File(dir, t.id)
                file.outputStream().use { out -> out.write(text.toByteArray(Charsets.UTF_8)); out.fd.sync() }
                t.localPath = file.absolutePath; t.size = file.length(); t.modified = file.lastModified()
                store.insert(t)
                runOnUiThread { start(listOf(t)); toast("Text queued") }
            }.onFailure { toast(it.message.orEmpty()) }
        }
    }

    private fun configured() = ConfigStore(this).current().also { require(it.baseUrl.isNotEmpty()) { "Configure your household server first" } }

    /** A temporary/non-seekable source is never copied silently, particularly at 20 GiB. */
    private fun intake(uris: List<Uri>, flags: Int, requestId: String?, reselectId: String? = null, kind: String = "file") {
        if (uris.size > 32) { finish(requestId, false, "Select up to 32 files per batch"); return }
        executor.execute {
            runCatching {
                configured()
                val sources = SourceAccess(this)
                val info = uris.map { uri ->
                    val i = sources.inspect(uri)
                    val durable = try {
                        if (flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
                    } catch (_: SecurityException) { false }
                    Triple(uri, i, durable && i.seekable && i.size >= 0)
                }
                val needsCopy = info.any { !it.third }
                runOnUiThread {
                    fun commit(stage: Boolean) {
                        executor.execute {
                            runCatching {
                                val c = configured()
                                val rows = info.map { (uri, i, durable) ->
                                    if (reselectId != null) {
                                        store.edit(reselectId) { t ->
                                            require(t.direction == "upload") { "Select a download destination instead" }
                                            require(t.size < 0 || i.size < 0 || t.size == i.size) { "Select the same file with the original size" }
                                            // Full persisted SHA-256 is checked by the engine before any resumed bytes.
                                            t.source = uri.toString(); t.localPath = ""; t.needsStaging = !durable
                                            if (t.fingerprint.isEmpty() && i.size >= 0) t.size = i.size
                                            t.modified = i.modified; t.status = "queued"; t.error = ""; t.retryAt = 0
                                        }
                                    } else Transfer(name = i.name, size = i.size, modified = i.modified, baseUrl = c.baseUrl, kind = kind,
                                        sourceDevice = c.sourceDevice, source = uri.toString(), needsStaging = !durable,
                                        mime = if (kind == "text") "text/plain" else contentResolver.getType(uri) ?: "application/octet-stream").also { store.insert(it) }
                                }
                                require(stage || !needsCopy)
                                runOnUiThread { start(rows); finish(requestId, true, JSONObject.NULL); toast("${rows.size} upload(s) queued") }
                            }.onFailure { finish(requestId, false, it.message.orEmpty()) }
                        }
                    }
                    if (!needsCopy) commit(false) else {
                        val size = info.filter { !it.third }.sumOf { it.second.size.coerceAtLeast(0) }
                        AlertDialog.Builder(this).setTitle("Make a durable local copy?")
                            .setMessage("This source offers temporary access, cannot seek, or has unknown size. A durable transfer needs a local staging copy (${if (size > 0) "$size bytes" else "size unknown"}). Local free space is checked with a 64 MiB reserve. No copy is made without your choice. Selecting the same file with the document picker can avoid staging.")
                            .setPositiveButton("Stage copy") { _, _ -> commit(true) }
                            .setNeutralButton("Select document") { _, _ -> pickUploads(requestId, reselectId, kind) }
                            .setNegativeButton("Cancel") { _, _ -> finish(requestId, false, "Share cancelled; no file was copied") }
                            .setOnCancelListener { finish(requestId, false, "Share cancelled") }.show()
                    }
                }
            }.onFailure { finish(requestId, false, it.message.orEmpty()) }
        }
    }

    private fun start(rows: List<Transfer>) {
        if (!visible) {
            rows.forEach { store.edit(it.id) { t -> t.error = "Queued. Open the app to start the user-initiated transfer." } }
            return
        }
        runCatching { TransferScheduler.startVisible(this, rows) }.onFailure { e -> rows.forEach { store.edit(it.id) { it.status = "error"; it.error = e.message.orEmpty() } }; toast(e.message.orEmpty()) }
    }

    private fun pickUploads(requestId: String?, reselectId: String? = null, kind: String = "file") {
        if (pending != null) { finish(requestId, false, "A file picker is already open"); return }
        require(kind in setOf("file", "text")) { "Invalid item kind" }
        pending = Pending(requestId, "upload", JSONObject().apply { put("kind", kind); if (reselectId != null) put("reselectId", reselectId) })
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, reselectId == null)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 200)
    }

    private fun pickDownload(requestId: String?, args: JSONObject) {
        if (pending != null) { finish(requestId, false, "A file picker is already open"); return }
        configured()
        pending = Pending(requestId, "download", args)
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, TransferPolicy.safeName(args.optString("name", "download")))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 200)
    }

    @Deprecated("Android framework callback retained for the small native wrapper")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 200) return
        val p = pending ?: return
        pending = null
        if (resultCode != RESULT_OK || data == null) { finish(p.requestId, true, JSONObject.NULL); return }
        if (p.type == "upload") {
            val uris = mutableListOf<Uri>()
            data.data?.let(uris::add)
            data.clipData?.let { c -> for (i in 0 until c.itemCount) uris.add(c.getItemAt(i).uri) }
            intake(uris.distinct(), data.flags, p.requestId, p.args.optString("reselectId").ifBlank { null }, p.args.optString("kind", "file"))
        } else {
            runCatching {
                val uri = data.data ?: error("No destination selected")
                require(data.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0) { "Destination is not writable" }
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                val c = configured()
                val old = p.args.optString("transferId")
                val t = if (old.isNotEmpty()) store.edit(old) { it.source = uri.toString(); it.status = "queued"; it.error = "" }
                else Transfer(direction = "download", name = TransferPolicy.safeName(p.args.optString("name", "download")),
                    itemId = p.args.getString("itemId"), baseUrl = c.baseUrl, sourceDevice = c.sourceDevice, source = uri.toString()).also { store.insert(it) }
                start(listOf(t)); finish(p.requestId, true, t.id)
            }.onFailure { finish(p.requestId, false, "Destination must support durable access: ${it.message}") }
        }
    }

    inner class Bridge {
        @JavascriptInterface fun request(id: String, command: String, raw: String) {
            if (raw.length > 40 * 1024 * 1024) { finish(id, false, "Request too large; import a text file"); return }
            // Cancellation/disconnect must not wait behind the text/API read they are cancelling.
            if (command == "native_cancel_api" || command == "native_disconnect") {
                runCatching {
                    if (command == "native_cancel_api") NativeHttp.cancelApi(JSONObject(raw).getString("requestId"))
                    else TransferScheduler.disconnect(this@MainActivity)
                    finish(id, true, JSONObject.NULL)
                }.onFailure { finish(id, false, it.message.orEmpty()) }
                return
            }
            executor.execute {
                runCatching {
                    val args = JSONObject(raw)
                    when (command) {
                        "native_configure" -> {
                            val c = ConfigStore(this@MainActivity).set(args)
                            finish(id, true, JSONObject().put("baseUrl", c.baseUrl).put("sourceDevice", c.sourceDevice).put("connected", c.connected))
                            runOnUiThread { maybeHandleShare() }
                        }
                        "native_get_config" -> {
                            val c = ConfigStore(this@MainActivity).current()
                            finish(id, true, JSONObject().put("baseUrl", c.baseUrl).put("sourceDevice", c.sourceDevice).put("connected", c.connected))
                        }
                        "native_list_transfers" -> finish(id, true, JSONArray(store.all().map { it.json(false) }))
                        "native_api" -> finish(id, true, NativeHttp(this@MainActivity).api(args))
                        "native_pick_uploads" -> {
                            configured()
                            if (args.has("sourceDevice")) ConfigStore(this@MainActivity).sourceDevice(args.getString("sourceDevice"))
                            runOnUiThread { runCatching { pickUploads(id, kind = args.optString("kind", "file")) }.onFailure { finish(id, false, it.message.orEmpty()) } }
                        }
                        "native_enqueue_upload" -> {
                            val uri = Uri.parse(args.getString("path"))
                            require(uri.scheme == "content") { "Android accepts document URIs only; use native_pick_uploads" }
                            val kind = args.optString("kind", "file")
                            require(kind in setOf("file", "text")) { "Invalid item kind" }
                            runOnUiThread { intake(listOf(uri), 0, id, kind = kind) }
                        }
                        "native_download" -> runOnUiThread { runCatching { pickDownload(id, args) }.onFailure { finish(id, false, it.message.orEmpty()) } }
                        "native_control" -> {
                            val t = store.get(args.getString("id")) ?: error("Unknown transfer")
                            val action = args.getString("action")
                            if (action == "resume" && t.status == "needs_source") {
                                runOnUiThread { if (t.direction == "upload") pickUploads(id, t.id)
                                    else pickDownload(id, JSONObject().put("transferId", t.id).put("name", t.name)) }
                            } else {
                                runOnUiThread {
                                    runCatching {
                                        val changed = TransferControlCommand.run(action,
                                            requireVisible = { check(visible && !isFinishing && !isDestroyed) { "Open the app to resume" } },
                                            change = { TransferScheduler.control(this@MainActivity, t.id, action) },
                                            schedule = { TransferScheduler.startVisible(this@MainActivity, listOf(it)) })
                                        finish(id, true, changed.json(false))
                                    }.onFailure { finish(id, false, it.message.orEmpty()) }
                                }
                            }
                        }
                        "native_copy_text" -> {
                            val text = args.getString("text")
                            require(text.toByteArray(Charsets.UTF_8).size <= TransferPolicy.COPY_LIMIT) { "Clipboard preparation is limited to 8 MiB; download the full .txt instead" }
                            runOnUiThread { runCatching {
                                require(visible) { "Open the app to copy text" }
                                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Household text", text))
                                finish(id, true, JSONObject().put("ok", true))
                            }.onFailure { finish(id, false, it.message.orEmpty()) } }
                        }
                        else -> error("Unsupported native command")
                    }
                }.onFailure { finish(id, false, it.message.orEmpty()) }
            }
        }
    }

    private fun finish(id: String?, success: Boolean, result: Any) {
        if (id == null) { if (!success) toast(result.toString()); return }
        if (PickerHandoff.complete(id, success, result)) { runOnUiThread { finish() }; return }
        val value = if (result === JSONObject.NULL || result is JSONObject || result is JSONArray) result.toString() else JSONObject.quote(result.toString())
        runOnUiThread {
            if (!isDestroyed) web.evaluateJavascript("window.__householdNativeComplete(${JSONObject.quote(id)},$success,$value)", null)
        }
    }
    private fun toast(text: String) = runOnUiThread { if (!isFinishing && !isDestroyed) Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    companion object {
        private val BOOTSTRAP = """
            (() => {
              const pending = new Map(); let seq = 0;
              window.__householdNativeComplete = (id, ok, value) => {
                const p = pending.get(id); if (!p) return; pending.delete(id);
                ok ? p.resolve(value) : p.reject(new Error(String(value)));
              };
              window.__HOUSEHOLD_NATIVE__ = Object.freeze({platform:'android',invoke(command,args={}) {
                return new Promise((resolve,reject) => {
                  const id = String(++seq); pending.set(id,{resolve,reject});
                  try { HouseholdBridge.request(id,command,JSON.stringify(args)); }
                  catch(e) { pending.delete(id); reject(e); }
                });
              }});
            })();
        """.trimIndent()
    }
}
