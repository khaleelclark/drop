package household.share.android

/** A full tus offset acknowledges bytes, not application validation or publication. */
class UploadRejected : Exception("Server rejected the uploaded content during validation. Cancel this transfer and send a corrected file.")
class PendingValidation : Exception("Upload received. Waiting for server validation; the local source is retained.")

class UploadCompletion(private val itemId: String, private val kind: String, private val size: Long) {
    data class Item(val id: String, val kind: String, val size: Long, val status: String)

    /** Used both after a full HEAD/PATCH and after a conflicting tus termination. */
    fun requireReady(fetch: () -> Item) {
        require(itemId.matches(Regex("[A-Za-z0-9_-]+"))) { "Upload item ID missing or invalid; cannot confirm publication" }
        val item = fetch()
        require(item.id == itemId && item.kind == kind && item.size == size) { "Server returned different upload metadata" }
        when (item.status) {
            "ready" -> return
            "failed" -> throw UploadRejected()
            "uploading" -> throw PendingValidation()
            else -> error("Unknown server upload state; publication is unconfirmed")
        }
    }
}
