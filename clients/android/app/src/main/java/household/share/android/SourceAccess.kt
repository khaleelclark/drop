package household.share.android

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

class NeedsSource(message: String) : Exception(message)
class SourceChanged : Exception("Source changed. Cancel this transfer and select the file as a new upload.")
class Paused : Exception()

class SourceAccess(private val context: Context) {
    data class Info(val name: String, val size: Long, val modified: Long, val seekable: Boolean)

    fun inspect(uri: Uri): Info {
        require(uri.scheme == "content") { "Select files using Android's document picker" }
        var name = "shared-file"
        var size = -1L
        var modified = -1L
        try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                    c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                    c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED).takeIf { it >= 0 && !c.isNull(it) }?.let { modified = c.getLong(it) }
                }
            }
            val seekable = context.contentResolver.openFileDescriptor(uri, "r")?.use { p ->
                if (size < 0) size = p.statSize
                runCatching { Os.lseek(p.fileDescriptor, 0, OsConstants.SEEK_SET); true }.getOrDefault(false)
            } ?: false
            require(size <= TransferPolicy.MAX_FILE) { "File exceeds the 20 GiB local client limit" }
            return Info(TransferPolicy.safeName(name), size, modified, seekable)
        } catch (e: SecurityException) { throw NeedsSource("Source permission expired. Reselect the same file using the document picker.") }
    }

    fun open(t: Transfer, offset: Long = 0): InputStream {
        try {
            if (t.localPath.isNotEmpty()) return FileInputStream(t.localPath).also { it.channel.position(offset) }
            val p = context.contentResolver.openFileDescriptor(Uri.parse(t.source), "r") ?: throw NeedsSource("Source is unavailable; reselect it.")
            try {
                Os.lseek(p.fileDescriptor, offset, OsConstants.SEEK_SET)
                return ParcelFileDescriptor.AutoCloseInputStream(p)
            } catch (e: Exception) {
                p.close()
                throw NeedsSource("This provider cannot seek. Reselect and explicitly stage a local copy.")
            }
        } catch (e: SecurityException) { throw NeedsSource("Source permission expired. Reselect the same file.") }
        catch (e: java.io.FileNotFoundException) { throw NeedsSource("Source was removed or moved. Reselect the same file.") }
    }

    fun currentInfo(t: Transfer): Info = if (t.localPath.isNotEmpty()) {
        val f = File(t.localPath)
        if (!f.isFile) throw NeedsSource("Local source is missing. Reselect the same file.")
        Info(t.name, f.length(), f.lastModified(), true)
    } else inspect(Uri.parse(t.source))

    fun verifyMetadata(t: Transfer) {
        val i = currentInfo(t)
        if (i.size != t.size || (t.modified > 0 && i.modified > 0 && i.modified != t.modified)) throw SourceChanged()
    }

    fun digest(t: Transfer, check: () -> Unit): String {
        verifyMetadata(t)
        val md = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(TransferPolicy.BUFFER)
        var total = 0L
        open(t).use { input ->
            while (true) {
                check()
                val n = input.read(buffer)
                if (n < 0) break
                total += n
                if (total > t.size) throw SourceChanged()
                md.update(buffer, 0, n)
            }
        }
        if (total != t.size) throw SourceChanged()
        verifyMetadata(t)
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Only used after explicit staging consent. No more than one private copy is kept. */
    fun stage(t: Transfer, check: () -> Unit, progress: (Long) -> Unit): File {
        val dir = File(context.filesDir, "staged").apply { mkdirs() }
        val dest = File(dir, t.id)
        // Staging is restarted, never appended to an unknown provider stream.
        dest.delete()
        val required = if (t.size >= 0) t.size else 0
        require(dir.usableSpace - TransferPolicy.RESERVE >= required) { "Insufficient local space for a durable staging copy. Use a seekable document provider instead." }
        try {
            context.contentResolver.openInputStream(Uri.parse(t.source)).use { input ->
                if (input == null) throw NeedsSource("Source unavailable; reselect it")
                dest.outputStream().use { out ->
                    val buffer = ByteArray(TransferPolicy.BUFFER)
                    var total = 0L
                    var checkpoint = 0L
                    while (true) {
                        check()
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        require(total <= TransferPolicy.MAX_FILE && (t.size < 0 || total <= t.size)) { "Source length changed or exceeds 20 GiB" }
                        require(dir.usableSpace > TransferPolicy.RESERVE + n) { "Local storage reserve reached while staging" }
                        out.write(buffer, 0, n)
                        if (total - checkpoint >= 1024 * 1024) { checkpoint = total; progress(total) }
                    }
                    if (t.size >= 0 && total != t.size) throw SourceChanged()
                    out.fd.sync()
                }
            }
            return dest
        } catch (e: Exception) {
            dest.delete()
            if (e is SecurityException) throw NeedsSource("Temporary share permission expired during staging. Reselect the source.")
            throw e
        }
    }
}
