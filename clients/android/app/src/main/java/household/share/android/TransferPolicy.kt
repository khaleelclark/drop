package household.share.android

import java.net.URI

object TransferPolicy {
    const val MAX_FILE = 20L * 1024 * 1024 * 1024
    const val CHUNK = 8L * 1024 * 1024
    const val BUFFER = 64 * 1024
    const val RESERVE = 64L * 1024 * 1024
    const val COPY_LIMIT = 8 * 1024 * 1024
    const val METADATA_LIMIT = 2 * 1024 * 1024

    fun recoverInterrupted(status: String, workerActive: Boolean, osJobPending: Boolean): Boolean =
        !workerActive && !osJobPending && status in setOf("running", "hashing", "staging", "exporting")

    fun runnableNow(status: String, retryAt: Long, now: Long): Boolean =
        status in setOf("queued", "retry_wait", "validating", "cancelling") && retryAt <= now

    data class NetworkEstimate(val bytes: Long, val minimumChunkBytes: Long?)

    /** JobInfo uses -1 for unknown bytes; a minimum chunk must never exceed known remaining bytes. */
    fun networkEstimate(size: Long, offset: Long): NetworkEstimate {
        require(size >= -1 && offset >= 0 && (size < 0 || offset <= size)) { "Invalid transfer length or offset" }
        if (size < 0) return NetworkEstimate(-1, null)
        val remaining = size - offset
        return NetworkEstimate(remaining, if (remaining > 0) minOf(CHUNK, remaining) else null)
    }

    fun baseUrl(raw: String, allowLoopback: Boolean): String {
        val u = URI(raw.trim())
        require(u.host != null && u.rawUserInfo == null && u.rawQuery == null && u.rawFragment == null) { "Use an HTTPS server URL without credentials, query, or fragment" }
        require(u.rawPath.isNullOrEmpty() || u.rawPath == "/") { "Use the server origin without /api" }
        val loopback = u.host in setOf("localhost", "127.0.0.1", "[::1]", "::1")
        require(u.scheme == "https" || (allowLoopback && u.scheme == "http" && loopback)) { "HTTPS required; HTTP is only available for explicit loopback development" }
        return raw.trim().trimEnd('/')
    }

    fun uploadLocation(base: String, raw: String): String {
        val origin = URI(base)
        val u = URI("$base/api/uploads/").resolve(raw)
        require(u.scheme == origin.scheme && u.host == origin.host && u.port == origin.port && u.rawUserInfo == null && u.rawFragment == null && u.rawQuery == null) { "Server returned an upload URL outside the configured origin" }
        require(u.rawPath.startsWith("/api/uploads/") && !u.rawPath.contains("..") && !u.rawPath.contains('%')) { "Invalid upload URL" }
        return u.toASCIIString()
    }

    fun safeName(raw: String): String = raw.replace(Regex("[\\x00-\\x1f\\x7f/\\\\]"), "_").take(200).ifBlank { "shared-file" }

    data class ByteRange(val start: Long, val end: Long, val total: Long)
    fun parseRange(value: String): ByteRange {
        val m = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(value) ?: error("Invalid Content-Range")
        val (a, b, c) = m.destructured
        val range = ByteRange(a.toLong(), b.toLong(), c.toLong())
        require(range.start >= 0 && range.end >= range.start && range.total > range.end && range.total <= MAX_FILE) { "Invalid download range" }
        return range
    }

    fun acknowledgedOffset(header: String?, expectedSize: Long): Long {
        val n = header?.toLongOrNull() ?: error("Missing or invalid server offset")
        require(n in 0..expectedSize) { "Server offset exceeds source length" }
        return n
    }
}
