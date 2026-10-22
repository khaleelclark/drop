package household.share.android

import android.content.Context
import android.net.Uri
import android.util.Base64
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/** One engine owns the queue at a time. Services, not the Activity/WebView, own its lifetime. */
class TransferEngine(private val context: Context, private val onProgress: (Transfer) -> Unit) {
    private val store = QueueStore.of(context)
    private val sources = SourceAccess(context)
    private val http = NativeHttp(context)
    private val stopping = AtomicBoolean(false)

    fun stop() { stopping.set(true); http.active?.cancel() }
    private fun check(id: String) {
        if (stopping.get() || store.get(id)?.status in setOf("paused", "cancelled", "cancelling")) throw Paused()
    }
    private fun progress(id: String, block: (Transfer) -> Unit = {}): Transfer = store.edit(id) { t ->
        if (t.status in setOf("paused", "cancelled", "cancelling")) throw Paused()
        block(t)
    }.also(onProgress)

    /** Returns whether Android should retry remaining work under the existing user-initiated job. */
    fun run(onlyId: String? = null): Boolean {
        val key = onlyId ?: "legacy-queue"
        if (!running.add(key)) return true
        fun selected() = store.all().filter { onlyId == null || it.id == onlyId }
        try {
            // A process death may have skipped all callbacks. The persisted offset remains authoritative.
            selected().filter { it.status in setOf("running", "hashing", "staging", "exporting") }.forEach {
                store.edit(it.id) { t -> t.status = "queued" }
            }
            for (initial in selected()) {
                if (stopping.get()) break
                if (initial.status == "cancelling") {
                    if (initial.retryAt <= System.currentTimeMillis()) terminate(initial)
                    continue
                }
                if (initial.status !in setOf("queued", "retry_wait", "validating")) continue
                if (initial.retryAt > System.currentTimeMillis()) continue
                try {
                    val t = progress(initial.id) { it.status = "running"; it.error = "" }
                    if (t.direction == "upload") upload(t) else download(t)
                    progress(t.id) { it.status = "completed"; it.offset = it.size; it.error = ""; it.attempts = 0 }
                    cleanupStaged(store.get(t.id)!!)
                } catch (e: Paused) {
                    store.edit(initial.id) { if (it.status !in setOf("paused", "cancelled", "cancelling")) it.status = "queued" }
                } catch (e: Exception) {
                    if (stopping.get()) {
                        store.edit(initial.id) { if (it.status !in setOf("paused", "cancelled", "cancelling")) it.status = "queued" }
                        break
                    }
                    store.edit(initial.id) { t ->
                        if (t.status in setOf("paused", "cancelled", "cancelling")) return@edit
                        t.attempts++
                        t.error = when (e) {
                            is NeedsSource -> e.message ?: "Reselect the source"
                            is SourceChanged -> e.message!!
                            is UploadRejected, is PendingValidation -> e.message!!
                            is HttpFailure -> "Server returned HTTP ${e.status}"
                            is IOException -> "Connection interrupted. Confirm Tailscale/server availability, then resume."
                            else -> e.message?.take(300) ?: "Transfer failed"
                        }
                        t.status = when {
                            e is NeedsSource -> "needs_source"
                            e is SourceChanged -> "error"
                            e is UploadRejected -> "error"
                            e is PendingValidation -> "validating"
                            e is HttpFailure && e.status !in setOf(408, 409, 423, 429, 500, 502, 503, 504) -> "error"
                            e is IOException && t.attempts <= 8 -> "retry_wait"
                            else -> "error"
                        }
                        t.retryAt = System.currentTimeMillis() + minOf(300_000L, 15_000L * (1L shl minOf(t.attempts, 4)))
                    }.also(onProgress)
                }
            }
            // A pause/cancel can arrive during the last chunk; process cancellation before returning.
            if (!stopping.get()) selected().filter { it.status == "cancelling" && it.retryAt <= System.currentTimeMillis() }.forEach(::terminate)
            return selected().any { it.status in setOf("queued", "retry_wait", "validating", "cancelling") }
        } finally { running.remove(key) }
    }

    private fun upload(initial: Transfer) {
        var t = initial
        // Reconcile lost final acknowledgements before touching a source that may no longer be accessible.
        if (t.uploadUrl.isNotEmpty()) {
            t = headUpload(t)
            if (t.offset == t.size) { requireUploadReady(t); return }
        }
        if (t.needsStaging) {
            progress(t.id) { it.status = "staging" }
            val staged = sources.stage(t, { check(t.id) }, { onProgress(store.get(t.id)!!.apply { error = "Staging $it bytes locally" }) })
            t = progress(t.id) {
                it.localPath = staged.absolutePath; it.size = staged.length(); it.modified = staged.lastModified()
                it.needsStaging = false; it.status = "hashing"
            }
        }
        require(t.size in 0..TransferPolicy.MAX_FILE) { "Known source length required; explicitly stage non-seekable/unknown sources" }
        progress(t.id) { it.status = "hashing" }
        val digest = sources.digest(t) { check(t.id) }
        if (t.fingerprint.isNotEmpty() && digest != t.fingerprint) throw SourceChanged()
        t = progress(t.id) { it.fingerprint = digest; it.status = "running" }
        if (t.uploadUrl.isEmpty()) {
            check(t.id)
            val metadata = linkedMapOf("filename" to t.name, "filetype" to t.mime, "kind" to t.kind, "sourceDevice" to t.sourceDevice)
                .entries.joinToString(",") { (k, v) -> "$k ${Base64.encodeToString(v.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)}" }
            val req = http.request(t, "${t.baseUrl}/api/uploads/").header("Tus-Resumable", "1.0.0")
                .header("Upload-Length", t.size.toString()).header("Upload-Metadata", metadata)
                .post(ByteArray(0).toRequestBody()).build()
            http.checked(http.execute(req), 201).use { r ->
                val location = TransferPolicy.uploadLocation(t.baseUrl, r.header("Location") ?: error("Upload URL missing"))
                // Preserve the returned URL even if Pause/Cancel raced with creation, so it can be terminated.
                t = store.edit(t.id) { it.uploadUrl = location; it.itemId = r.header("X-Item-ID").orEmpty() }.also(onProgress)
                check(t.id)
            }
        }
        // Every retry consults the server; a dropped PATCH response must never cause a duplicate chunk.
        t = headUpload(t)
        while (t.offset < t.size) {
            check(t.id)
            sources.verifyMetadata(t)
            val length = minOf(TransferPolicy.CHUNK, t.size - t.offset)
            // Detect changes anywhere in the source before publishing the final chunk.
            if (t.offset + length == t.size && sources.digest(t) { check(t.id) } != t.fingerprint) throw SourceChanged()
            val req = http.request(t, t.uploadUrl).header("Tus-Resumable", "1.0.0").header("Upload-Offset", t.offset.toString())
                .patch(http.chunk(t, sources, t.offset, length) { check(t.id) }).build()
            val response = http.execute(req)
            if (response.code == 422) {
                response.close()
                requireUploadReady(t) // records failed/pending accurately; a transport error alone is not success
                t = progress(t.id) { it.offset = it.size }
                break
            }
            http.checked(response, 204).use { r ->
                val next = TransferPolicy.acknowledgedOffset(r.header("Upload-Offset"), t.size)
                require(next == t.offset + length) { "Server acknowledged an unexpected offset" }
                t = progress(t.id) { it.offset = next; it.attempts = 0 }
            }
        }
        requireUploadReady(t)
    }

    private fun headUpload(t: Transfer): Transfer {
        check(t.id)
        val head = http.request(t, TransferPolicy.uploadLocation(t.baseUrl, t.uploadUrl)).head().header("Tus-Resumable", "1.0.0").build()
        val response = http.execute(head)
        if (response.code == 422) {
            response.close()
            requireUploadReady(t)
            return progress(t.id) { it.offset = it.size }
        }
        http.checked(response, 200, 204).use { r ->
            require(r.header("Upload-Length")?.toLongOrNull() == t.size) { "Server/source lengths differ" }
            val offset = TransferPolicy.acknowledgedOffset(r.header("Upload-Offset"), t.size)
            return progress(t.id) { it.offset = offset }
        }
    }

    private fun requireUploadReady(t: Transfer) {
        UploadCompletion(t.itemId, t.kind, t.size).requireReady {
            val req = http.request(t, "${t.baseUrl}/api/items/${t.itemId}").get().build()
            http.checked(http.execute(req), 200).use { r ->
                val body = r.body ?: error("Upload item response missing")
                require(body.contentLength() <= TransferPolicy.METADATA_LIMIT) { "Upload metadata exceeded the response budget" }
                val source = body.source()
                val buffer = okio.Buffer()
                while (!source.exhausted() && buffer.size <= TransferPolicy.METADATA_LIMIT) {
                    source.read(buffer, minOf(TransferPolicy.BUFFER.toLong(), TransferPolicy.METADATA_LIMIT + 1L - buffer.size))
                }
                require(buffer.size <= TransferPolicy.METADATA_LIMIT) { "Upload metadata exceeded the response budget" }
                val item = JSONObject(buffer.readUtf8()).getJSONObject("item")
                UploadCompletion.Item(item.getString("id"), item.getString("kind"), item.getLong("size"), item.getString("status"))
            }
        }
    }

    private fun download(initial: Transfer) {
        var t = initial
        require(Regex("[A-Za-z0-9_-]+").matches(t.itemId)) { "Invalid item ID" }
        val url = "${t.baseUrl}/api/items/${t.itemId}/download"
        http.checked(http.execute(http.request(t, url).head().build()), 200).use { r ->
            val size = r.header("Content-Length")?.toLongOrNull() ?: error("Download size missing")
            require(size in 0..TransferPolicy.MAX_FILE) { "Unsupported download size" }
            val etag = r.header("ETag").orEmpty()
            require(etag.startsWith('"') && etag.endsWith('"') && !etag.startsWith("W/")) { "Strong ETag required for resumable download" }
            if (t.etag.isNotEmpty() && (t.etag != etag || t.size != size)) invalidateDownload(t, "Server file changed; partial copy discarded. Resume to download the current file.")
            t = progress(t.id) { it.size = size; it.etag = etag }
        }
        val dir = File(context.filesDir, "downloads").apply { mkdirs() }
        val file = File(dir, "${t.id}.part")
        val confirmed = minOf(t.offset, if (file.exists()) file.length() else 0)
        require(dir.usableSpace - TransferPolicy.RESERVE >= t.size - confirmed) { "Insufficient local space for the download" }
        t = progress(t.id) { it.offset = confirmed; it.localPath = file.absolutePath }
        RandomAccessFile(file, "rw").use { out ->
            out.setLength(confirmed)
            out.seek(confirmed)
            val buffer = ByteArray(TransferPolicy.BUFFER)
            while (t.offset < t.size) {
                check(t.id)
                val start = t.offset
                val end = minOf(t.size, start + TransferPolicy.CHUNK) - 1
                val req = http.request(t, url).header("Range", "bytes=${t.offset}-$end").header("If-Range", t.etag).get().build()
                http.checked(http.execute(req), 200, 206).use { r ->
                    if (r.header("ETag") != t.etag) invalidateDownload(t, "Server file changed; partial copy discarded. Resume to restart.")
                    if (r.code == 200 && start > 0) invalidateDownload(t, "Server ignored the resume range; partial copy discarded. Resume to restart safely.")
                    if (r.code == 206) {
                        val range = TransferPolicy.parseRange(r.header("Content-Range").orEmpty())
                        require(range.start == start && range.end == end && range.total == t.size) { "Server returned an invalid download range" }
                    }
                    // At offset zero a full 200 response is safe to stream from the beginning.
                    val expectedEnd = if (r.code == 200) t.size - 1 else end
                    val length = expectedEnd - start + 1
                    require(r.body?.contentLength() == length) { "Download chunk length mismatch" }
                    var remaining = length
                    var checkpoint = start
                    r.body!!.byteStream().use { input ->
                        while (remaining > 0) {
                            check(t.id)
                            require(dir.usableSpace > TransferPolicy.RESERVE + buffer.size) { "Local storage reserve reached" }
                            val n = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                            if (n < 0) throw IOException("Download interrupted")
                            out.write(buffer, 0, n); remaining -= n
                            val written = start + length - remaining
                            if (written - checkpoint >= TransferPolicy.CHUNK) {
                                out.fd.sync(); checkpoint = written
                                t = progress(t.id) { it.offset = written; it.attempts = 0 }
                            }
                        }
                        require(input.read() == -1) { "Download exceeded declared range" }
                    }
                    out.fd.sync()
                    t = progress(t.id) { it.offset = expectedEnd + 1; it.attempts = 0 }
                }
            }
        }
        val expectedHash = Regex("\"sha256-([0-9a-f]{64})\"").matchEntire(t.etag)?.groupValues?.get(1)
        if (expectedHash != null) {
            progress(t.id) { it.status = "hashing" }
            val hash = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(TransferPolicy.BUFFER)
                while (true) { check(t.id); val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
            }
            if (hash.digest().joinToString("") { "%02x".format(it) } != expectedHash) {
                RandomAccessFile(file, "rw").use { it.setLength(0); it.fd.sync() }
                progress(t.id) { it.offset = 0 }
                throw IOException("Downloaded checksum mismatch; retry from the beginning")
            }
        }
        // Destination chosen using ACTION_CREATE_DOCUMENT. Native private .part is never served as ready.
        progress(t.id) { it.status = "exporting" }
        try {
            context.contentResolver.openOutputStream(Uri.parse(t.source), "wt").use { output ->
                require(output != null) { "Download destination unavailable; choose it again" }
                file.inputStream().use { input ->
                    val buffer = ByteArray(TransferPolicy.BUFFER)
                    while (true) { check(t.id); val n = input.read(buffer); if (n < 0) break; output.write(buffer, 0, n) }
                }
                output.flush()
            }
        } catch (e: SecurityException) { throw NeedsSource("Download destination access expired. Reselect a destination.") }
        catch (e: java.io.FileNotFoundException) { throw NeedsSource("Download destination unavailable. Reselect a destination.") }
        // Only remove the private resumable copy after the completed state is committed in run().
    }

    private fun invalidateDownload(t: Transfer, message: String): Nothing {
        if (t.localPath.isNotEmpty()) {
            val file = File(t.localPath)
            if (file.canonicalPath.startsWith(File(context.filesDir, "downloads").canonicalPath + File.separator)) file.delete()
        }
        store.edit(t.id) { it.offset = 0; it.etag = ""; it.size = -1; it.localPath = "" }
        throw IllegalStateException(message)
    }

    private fun terminate(t: Transfer) {
        try {
            if (t.uploadUrl.isNotEmpty() && t.direction == "upload") {
                val req = http.request(t, TransferPolicy.uploadLocation(t.baseUrl, t.uploadUrl)).header("Tus-Resumable", "1.0.0").delete().build()
                val response = http.execute(req)
                if (response.code == 409 || response.code == 422) {
                    response.close()
                    // Cancel cannot delete content that has already become visible to the household.
                    requireUploadReady(t)
                    val settled = store.edit(t.id) {
                        if (it.status == "cancelling") { it.status = "completed"; it.offset = it.size; it.error = "" }
                    }.also(onProgress)
                    if (settled.status == "completed") cleanupStaged(settled)
                    return
                }
                http.checked(response, 204, 404, 410).close()
            }
            val settled = store.edit(t.id) { if (it.status == "cancelling") { it.status = "cancelled"; it.error = "" } }.also(onProgress)
            if (settled.status == "cancelled") cleanupStaged(settled)
        } catch (e: Exception) {
            store.edit(t.id) {
                if (it.status != "cancelling") return@edit
                it.retryAt = System.currentTimeMillis() + 30_000
                if (e is UploadRejected) { it.status = "error"; it.error = e.message!! }
                else it.error = if (e is PendingValidation) "Cancellation pending while the server validates the upload. The local source is retained."
                    else "Cancellation pending: reconnect to the original server and Resume to remove its partial upload."
            }.also(onProgress)
        }
    }

    private fun cleanupStaged(t: Transfer) {
        if (t.localPath.isNotEmpty()) {
            val f = File(t.localPath)
            val root = context.filesDir.canonicalPath + File.separator
            if (f.canonicalPath.startsWith(root)) f.delete()
        }
        File(context.filesDir, "staged/${t.id}").delete()
    }
    companion object {
        private val running = ConcurrentHashMap.newKeySet<String>()
        fun isActive(id: String) = running.contains(id) || running.contains("legacy-queue")
    }
}
