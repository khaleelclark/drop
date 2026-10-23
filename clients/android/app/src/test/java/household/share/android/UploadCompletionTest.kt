package household.share.android

import org.junit.Assert.*
import org.junit.Test

class UploadCompletionTest {
    private val completion = UploadCompletion("upload_1", "text", 20_000_000_000)
    private fun item(status: String) = UploadCompletion.Item("upload_1", "text", 20_000_000_000, status)

    @Test fun fullOffsetFollowedByFailedValidationRemainsAnErrorOnEveryResume() {
        // The Go server can retain a full tus offset after its first final PATCH returned 422.
        repeat(2) {
            try { completion.requireReady { item("failed") }; fail("Invalid UTF-8 must never settle as completed") }
            catch (e: UploadRejected) { assertTrue(e.message!!.contains("validation")) }
        }
    }
    @Test fun pendingValidationCannotReleaseStagingAndCanBecomeReadyLater() {
        val responses = ArrayDeque(listOf(item("uploading"), item("uploading"), item("ready")))
        var cleanups = 0
        repeat(3) {
            try { completion.requireReady { responses.removeFirst() }; cleanups++ }
            catch (_: PendingValidation) { assertEquals(0, cleanups) }
        }
        assertEquals(1, cleanups)
        assertTrue(responses.isEmpty())
    }
    @Test fun lostFinalAcknowledgementAndCancelConflictSettleAlreadyReadyContent() {
        var probes = 0
        completion.requireReady { probes++; item("ready") }
        assertEquals(1, probes) // Only the item probe is needed; no item Delete or source reread.
    }
    @Test fun cancelConflictDuringValidationRemainsPending() {
        try { completion.requireReady { item("uploading") }; fail("Cancellation cannot announce completion while validating") }
        catch (_: PendingValidation) { }
    }
    @Test fun cancelConflictWithFailedValidationRemainsAnAccurateError() {
        try { completion.requireReady { item("failed") }; fail("Cancellation cannot announce success for rejected bytes") }
        catch (_: UploadRejected) { }
    }
    @Test fun mismatchedItemIdentityOrKindCannotPublishEvenAfterAnEdit() {
        listOf(item("ready").copy(id = "other", size = 0), item("ready").copy(kind = "file", size = 1)).forEach { wrong ->
            try { completion.requireReady { wrong }; fail("Wrong item metadata accepted") }
            catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun readyTextCanBeEditedLargerSmallerOrEmptyAfterOriginalTusCompletion() {
        val originalSize = 20_000_000_000L
        assertEquals(originalSize, TransferPolicy.acknowledgedOffset(originalSize.toString(), originalSize))
        listOf(originalSize + 1, 1L, 0L).forEach { editedSize ->
            var probes = 0
            completion.requireReady { probes++; item("ready").copy(size = editedSize) }
            assertEquals(1, probes)
        }
    }
    @Test fun pendingThenEditedReadyAlsoSettlesLostAcknowledgementAndCancelRecovery() {
        listOf(20_000_000_001L, 1L, 0L).forEach { editedSize ->
            val responses = ArrayDeque(listOf(item("uploading"), item("ready").copy(size = editedSize)))
            try { completion.requireReady { responses.removeFirst() }; fail("Pending validation accepted") }
            catch (_: PendingValidation) { }
            repeat(2) { completion.requireReady { responses.first() } } // Both recovery paths share this gate.
            assertEquals(1, responses.size)
        }
    }
    @Test fun incompleteItemsStillRequireTheOriginalSourceSize() {
        listOf("uploading", "failed").forEach { status ->
            listOf(20_000_000_001L, 1L, 0L).forEach { wrongSize ->
                try { completion.requireReady { item(status).copy(size = wrongSize) }; fail("Incomplete length mismatch accepted") }
                catch (_: IllegalArgumentException) { }
            }
        }
    }
    @Test fun missingItemIdOrUnknownStatusCannotBecomeCompleted() {
        try { UploadCompletion("", "text", 0).requireReady { error("Must not fetch an unscoped item") }; fail() }
        catch (_: IllegalArgumentException) { }
        try { completion.requireReady { item("unrecognized") }; fail() }
        catch (_: IllegalStateException) { }
    }
}
