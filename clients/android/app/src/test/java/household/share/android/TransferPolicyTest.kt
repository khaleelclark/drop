package household.share.android

import org.junit.Assert.*
import org.junit.Test

class TransferPolicyTest {
    private fun rejected(block: () -> Unit) {
        try { block(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
    }
    @Test fun rejectsPublicCleartextAndUrlCredentials() {
        rejected { TransferPolicy.baseUrl("http://host.example", true) }
        rejected { TransferPolicy.baseUrl("https://user:pass@host.example", false) }
        rejected { TransferPolicy.baseUrl("https://host.example/api", false) }
        rejected { TransferPolicy.baseUrl("https://host.example?token=secret", false) }
        rejected { TransferPolicy.baseUrl("http://localhost:4300", false) }
        assertEquals("http://localhost:4300", TransferPolicy.baseUrl("http://localhost:4300/", true))
        assertEquals("https://house.tailnet.ts.net", TransferPolicy.baseUrl("https://house.tailnet.ts.net/", false))
    }
    @Test fun uploadLocationsStayWithinConfiguredOriginAndRoute() {
        val base = "https://house.tailnet.ts.net"
        assertEquals("$base/api/uploads/abc", TransferPolicy.uploadLocation(base, "abc"))
        assertEquals("$base/api/uploads/abc", TransferPolicy.uploadLocation(base, "/api/uploads/abc"))
        rejected { TransferPolicy.uploadLocation(base, "https://attacker.invalid/api/uploads/abc") }
        rejected { TransferPolicy.uploadLocation(base, "//attacker.invalid/api/uploads/abc") }
        rejected { TransferPolicy.uploadLocation(base, "/api/other") }
        rejected { TransferPolicy.uploadLocation(base, "/api/uploads/%2e%2e/token") }
    }
    @Test fun offsetsUse64BitIntegersAndNeverExceedSource() {
        val n = 20L * 1000 * 1000 * 1000
        assertEquals(n, TransferPolicy.acknowledgedOffset(n.toString(), n))
        rejected { TransferPolicy.acknowledgedOffset("-1", n) }
        rejected { TransferPolicy.acknowledgedOffset((n + 1).toString(), n) }
    }
    @Test fun contentRangesRejectWrongShapeAndOversizedTotals() {
        assertEquals(TransferPolicy.ByteRange(8_589_934_592, 8_598_323_199, 20_000_000_000), TransferPolicy.parseRange("bytes 8589934592-8598323199/20000000000"))
        rejected { TransferPolicy.parseRange("bytes 5-4/10") }
        rejected { TransferPolicy.parseRange("bytes 0-10/10") }
        rejected { TransferPolicy.parseRange("bytes 0-1/${TransferPolicy.MAX_FILE + 1}") }
    }
    @Test fun unsafeProviderNamesNeverBecomePaths() {
        assertEquals(".._private_file_", TransferPolicy.safeName("../private\\file\n"))
        assertEquals("shared-file", TransferPolicy.safeName(" "))
        assertEquals(200, TransferPolicy.safeName("a".repeat(1000)).length)
    }
    @Test fun reopenRecoversEveryInterruptedStateOnlyWhenNoWorkerOrJobOwnsIt() {
        listOf("running", "hashing", "staging", "exporting").forEach { state ->
            assertTrue(TransferPolicy.recoverInterrupted(state, false, false))
            assertFalse(TransferPolicy.recoverInterrupted(state, true, false))
            assertFalse(TransferPolicy.recoverInterrupted(state, false, true))
        }
        listOf("paused", "cancelled", "completed", "error", "needs_source", "cancelling", "validating").forEach {
            assertFalse(TransferPolicy.recoverInterrupted(it, false, false))
        }
    }
    @Test fun newlyQueuedWorkDrainsButFutureRetriesCannotBusyLoop() {
        assertTrue(TransferPolicy.runnableNow("queued", 0, 100))
        listOf("retry_wait", "validating", "cancelling").forEach {
            assertFalse(TransferPolicy.runnableNow(it, 101, 100))
            assertTrue(TransferPolicy.runnableNow(it, 100, 100))
        }
        assertFalse(TransferPolicy.runnableNow("paused", 0, 100))
    }
    @Test fun unknownDownloadOmitsMinimumNetworkChunk() {
        assertEquals(TransferPolicy.NetworkEstimate(-1, null), TransferPolicy.networkEstimate(-1, 0))
    }
    @Test fun zeroByteAndAlreadyTransferredItemsOmitMinimumChunk() {
        assertEquals(TransferPolicy.NetworkEstimate(0, null), TransferPolicy.networkEstimate(0, 0))
        assertEquals(TransferPolicy.NetworkEstimate(0, null), TransferPolicy.networkEstimate(123, 123))
    }
    @Test fun minimumChunkUsesRemainingBytesRatherThanTotalLength() {
        val total = 4 * TransferPolicy.CHUNK + 701
        assertEquals(TransferPolicy.NetworkEstimate(701, 701), TransferPolicy.networkEstimate(total, total - 701))
        assertEquals(TransferPolicy.NetworkEstimate(total, TransferPolicy.CHUNK), TransferPolicy.networkEstimate(total, 0))
    }
    @Test fun invalidNetworkEstimatesCannotReachJobInfo() {
        rejected { TransferPolicy.networkEstimate(-2, 0) }
        rejected { TransferPolicy.networkEstimate(1, -1) }
        rejected { TransferPolicy.networkEstimate(1, 2) }
    }
}
