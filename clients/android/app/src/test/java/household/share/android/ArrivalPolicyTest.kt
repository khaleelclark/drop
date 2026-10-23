package household.share.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ArrivalPolicyTest {
    private val item = "3".repeat(32)
    private fun page(vararg seq: String, after: String = "0", next: String = seq.lastOrNull() ?: after, more: Boolean = false): ArrivalPolicy.Page {
        val rows = JSONArray(seq.map { JSONObject().put("sequence", it).put("itemId", item).put("createdAt", "2026-10-23T00:00:00Z") })
        return ArrivalPolicy.page(JSONObject().put("notifications", rows).put("nextCursor", next).put("ackCursor", "0").put("hasMore", more), after)
    }
    @Test fun cursorSupportsAllSqlite64BitsWithoutFloatingPoint() {
        assertEquals(Long.MAX_VALUE, ArrivalPolicy.cursor("9223372036854775807"))
        for (value in listOf("", "-1", "+1", "01", "1.0", " 1", "9223372036854775808")) assertThrows(Exception::class.java) { ArrivalPolicy.cursor(value) }
    }
    @Test fun invalidPageCannotAdvanceOrAck() {
        assertThrows(Exception::class.java) { page("2", "1") }
        assertThrows(Exception::class.java) { page("1", "1") }
        assertThrows(Exception::class.java) { page("1", after = "2") }
        assertThrows(Exception::class.java) { page("1", next = "4") }
        assertThrows(Exception::class.java) { page(more = true) }
        val bad = JSONObject().put("notifications", JSONArray().put(JSONObject().put("sequence", 1).put("itemId", item)))
            .put("nextCursor", "1").put("ackCursor", "0").put("hasMore", false)
        assertThrows(Exception::class.java) { ArrivalPolicy.page(bad, "0") }
    }
    @Test fun batchIsPostedThenCommittedThenAcked() {
        val events = mutableListOf<String>()
        ArrivalPolicy.process(page("1", "2", "9007199254740993"), "0", { events += "post:${it.sequence}" }, { events += "persist:$it" }, { events += "ack:$it" })
        assertEquals(listOf("post:9007199254740993", "persist:9007199254740993", "ack:9007199254740993"), events)
    }
    @Test fun lostAckDoesNotRedisplayPersistedBatchAndNeverRegresses() {
        val page = page("123", "124", after = "122")
        var saved: String? = "122"; var posts = 0
        assertThrows(IllegalStateException::class.java) {
            ArrivalPolicy.process(page, saved, { posts++ }, { saved = it }, { error("Lost ACK") })
        }
        assertEquals("124", saved)
        var acked = ""
        ArrivalPolicy.process(page, saved, { posts++ }, { saved = it }, { acked = it })
        assertEquals(1, posts); assertEquals("124", acked)
        assertThrows(Exception::class.java) { ArrivalPolicy.process(page, "125", {}, {}, {}) }
    }
    @Test fun postingOrDiskFailureCannotAckUnprocessedContent() {
        var ack = false; var persisted = false
        assertThrows(IllegalStateException::class.java) {
            ArrivalPolicy.process(page("1"), "0", { error("OS failure") }, { persisted = true }, { ack = true })
        }
        assertFalse(ack); assertFalse(persisted)
        assertThrows(IllegalStateException::class.java) {
            ArrivalPolicy.process(page("1"), "0", {}, { error("Disk full") }, { ack = true })
        }
        assertFalse(ack)
    }
    @Test fun enablePromptAndRuntimeAppOrChannelDenialDoNotConsumeArrivalsBeforeGrant() {
        var enabled = false; var permission = "granted"; var saved = "0"; var acked = "0"
        val events = mutableListOf<String>()
        fun poll() {
            if (!ArrivalPolicy.canCheck(enabled, permission)) return
            events += "fetch:$saved"
            ArrivalPolicy.process(page("1"), saved, {
                ArrivalNotifications.post({ permission }) { events += "post:${it.sequence}" }
            }, { saved = it; events += "persist:$it" }, { acked = it; events += "ack:$it" })
        }
        poll() // Default off even if Android permission was previously granted.
        enabled = true
        for (blocked in listOf(
            ArrivalPolicy.permission(false, false, false, true), // Enable opens the prompt.
            ArrivalPolicy.permission(false, true, false, true), // Runtime denial.
            ArrivalPolicy.permission(true, true, false, true), // App blocked in Settings.
            ArrivalPolicy.permission(true, true, true, false) // Channel blocked in Settings.
        )) {
            permission = blocked; poll()
            assertTrue(events.isEmpty()); assertEquals("0", saved); assertEquals("0", acked)
        }
        permission = ArrivalPolicy.permission(true, true, true, true); poll()
        assertEquals(listOf("fetch:0", "post:1", "persist:1", "ack:1"), events)
        assertEquals("1", saved); assertEquals("1", acked)
        enabled = false; poll()
        assertEquals(4, events.size)
    }
    @Test fun permissionLossAtTheActualPostingGatePreservesCursorAndAck() {
        for (permission in listOf("prompt", "denied", "unknown", "unavailable")) {
            var saved = "0"; var acked = "0"; var sends = 0
            assertThrows(IllegalStateException::class.java) {
                ArrivalPolicy.process(page("1"), saved, {
                    ArrivalNotifications.post({ permission }) { sends++ }
                }, { saved = it }, { acked = it })
            }
            assertEquals(0, sends); assertEquals("0", saved); assertEquals("0", acked)
        }
    }
    @Test fun actualPostingAdapterPropagatesSecurityExceptionAndRetriesTheSameArrival() {
        var saved = "0"; var acked = "0"; val events = mutableListOf<String>()
        val denied = SecurityException("Permission changed during notify")
        val thrown = assertThrows(SecurityException::class.java) {
            ArrivalPolicy.process(page("1"), saved, {
                ArrivalNotifications.post({ "granted" }) { events += "failed:${it.sequence}"; throw denied }
            }, { saved = it }, { acked = it })
        }
        assertSame(denied, thrown); assertEquals("0", saved); assertEquals("0", acked)
        ArrivalPolicy.process(page("1"), saved, {
            ArrivalNotifications.post({ "granted" }) { events += "posted:${it.sequence}" }
        }, { saved = it; events += "persist:$it" }, { acked = it; events += "ack:$it" })
        assertEquals(listOf("failed:1", "posted:1", "persist:1", "ack:1"), events)
        assertEquals("1", saved); assertEquals("1", acked)
    }
    @Test fun emptyPageOnlyAcksTheServerIssuedCursor() {
        val events = mutableListOf<String>()
        ArrivalPolicy.process(page(after = "7"), "7", { error("Must not post") }, { error("Must not rewrite") }, { events += it })
        assertEquals(listOf("7"), events)
    }
    @Test fun simultaneousForegroundAndJobRunsHaveOneOwnerAndStaleFinishCannotClearIt() {
        val flight = ArrivalFlight()
        val pool = Executors.newFixedThreadPool(8); val start = CountDownLatch(1)
        try {
            val futures = (1..8).map { pool.submit<ArrivalFlight.Ticket?> { start.await(); flight.begin() } }
            start.countDown()
            val tickets = futures.mapNotNull { it.get(3, TimeUnit.SECONDS) }
            assertEquals(1, tickets.size)
            val old = tickets.single(); var cancelledIo = 0; old.cancelIo = { cancelledIo++ }
            flight.stop(); assertEquals(1, cancelledIo)
            assertThrows(IllegalStateException::class.java) { flight.current(old) { error("Cancelled run posted") } }
            assertNull(flight.begin()); flight.finish(old)
            val next = flight.begin()!!; flight.finish(old)
            assertNull(flight.begin()); flight.current(next) { }; flight.finish(next)
            assertNotNull(flight.begin())
        } finally { pool.shutdownNow() }
    }
    @Test fun permissionAndChannelDenialRemainVisibleAndBackoffIsBounded() {
        assertEquals("prompt", ArrivalPolicy.permission(false, false, false, true))
        assertEquals("denied", ArrivalPolicy.permission(false, true, false, true))
        assertEquals("denied", ArrivalPolicy.permission(true, true, false, true))
        assertEquals("denied", ArrivalPolicy.permission(true, true, true, false))
        assertEquals("granted", ArrivalPolicy.permission(true, false, true, true))
        assertEquals(15_000L, ArrivalPolicy.retryDelay(0)); assertEquals(30_000L, ArrivalPolicy.retryDelay(1))
        assertEquals(300_000L, ArrivalPolicy.retryDelay(Int.MAX_VALUE))
    }
    @Test fun clickTargetsRejectOtherPairingsAndRemotePayloads() {
        assertTrue(ArrivalPolicy.target("https://household.example", "https://HOUSEHOLD.example:443/", item))
        for (base in listOf("https://other.example", "https://household.example:444", "https://household.example/path", "https://secret@household.example", "https://household.example?token=secret")) {
            assertFalse(ArrivalPolicy.target("https://household.example", base, item))
        }
        assertFalse(ArrivalPolicy.target("", "https://household.example", item))
        assertFalse(ArrivalPolicy.target("https://household.example", "https://household.example", "../../../download"))
        val a = ArrivalPolicy.notificationKey("https://household.example", "1".repeat(32), "124")
        assertEquals(a, ArrivalPolicy.notificationKey("https://HOUSEHOLD.example:443/", "1".repeat(32), "124"))
        assertNotEquals(a, ArrivalPolicy.notificationKey("https://household.example", "2".repeat(32), "124"))
        assertNotEquals(a, ArrivalPolicy.notificationKey("https://other.example", "1".repeat(32), "124"))
        assertFalse(a.contains(item))
    }
    @Test fun clickHandoffIsDurableConsumedOnceAndClearedAfterPairingChanges() {
        var disk: Pair<String, String>? = null
        fun open() = ArrivalTargetStore({ disk ?: ("" to "") }, { disk = it })
        assertTrue(open().save("https://household.example", true, "https://household.example", item))
        assertEquals("https://household.example" to item, open().take("https://household.example", true))
        assertNull(open().take("https://household.example", true))
        assertTrue(open().save("https://HOUSEHOLD.example:443/", true, "https://household.example", item))
        assertEquals("https://household.example" to item, open().take("https://HOUSEHOLD.example:443/", true))
        assertTrue(open().save("https://household.example", true, "https://household.example", item))
        assertNull(open().take("https://other.example", true)); assertNull(disk)
        assertFalse(open().save("https://household.example", false, "https://household.example", item))
        assertNull(disk)
        val failing = ArrivalTargetStore({ "https://household.example" to item }, { error("Disk full") })
        assertThrows(IllegalStateException::class.java) { failing.take("https://household.example", true) }
    }
    @Test fun backgroundEnableCannotSaveOrPromptButDisableRemainsAvailable() {
        var saves = 0; var prompts = 0
        assertThrows(IllegalStateException::class.java) {
            ArrivalPolicy.control(true, { error("Activity is not resumed") }) { saves++; prompts++ }
        }
        assertEquals(0, saves); assertEquals(0, prompts)
        ArrivalPolicy.control(false, { error("Must not require visibility to disable") }) { saves++ }
        assertEquals(1, saves); assertEquals(0, prompts)
        ArrivalPolicy.control(true, {}) { saves++; prompts++ }
        assertEquals(2, saves); assertEquals(1, prompts)
    }
    @Test fun cancellationBeforeHttpAttachmentCancelsTheLaterCall() {
        val flight = ArrivalFlight(); val ticket = flight.begin()!!
        flight.stop()
        var cancelled = false; ticket.cancelIo = { cancelled = true }
        assertTrue(cancelled)
        assertThrows(IllegalStateException::class.java) { ticket.check() }
    }
}
