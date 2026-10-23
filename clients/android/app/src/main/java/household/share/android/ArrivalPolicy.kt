package household.share.android

import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

object ArrivalPolicy {
    fun canCheck(enabled: Boolean, permission: String) = enabled && permission == "granted"
    fun <T> control(enabled: Boolean, requireVisible: () -> Unit, change: () -> T): T {
        if (enabled) requireVisible()
        return change()
    }
    fun retryDelay(attempt: Int): Long = minOf(300_000L, 15_000L * (1L shl attempt.coerceIn(0, 5)))
    fun cursor(raw: String): Long {
        require(Regex("0|[1-9][0-9]*").matches(raw)) { "Invalid arrival cursor" }
        return raw.toLongOrNull()?.also { require(it >= 0) } ?: error("Arrival cursor is too large")
    }
    fun scope(base: String, device: String) = DevicePolicy.key(DevicePolicy.origin(base) + ":" + DevicePolicy.id(device))
    fun notificationKey(base: String, device: String, sequence: String): String {
        cursor(sequence)
        return DevicePolicy.key(scope(base, device) + ":" + sequence)
    }
    fun target(paired: String, base: String, item: String): Boolean = runCatching {
        DevicePolicy.id(item)
        paired.isNotEmpty() && DevicePolicy.origin(paired) == DevicePolicy.origin(base)
    }.getOrDefault(false)

    data class Entry(val sequence: String, val itemId: String)
    data class Page(val entries: List<Entry>, val next: String, val ack: String, val more: Boolean)
    fun page(json: JSONObject, after: String?): Page {
        val ack = json.get("ackCursor") as? String ?: error("Cursor must be a string")
        cursor(ack)
        val start = after ?: ack
        var previous = cursor(start)
        val rows = json.getJSONArray("notifications")
        require(rows.length() <= 50) { "Too many arrivals" }
        val entries = (0 until rows.length()).map { i ->
            val row = rows.getJSONObject(i)
            val seq = row.get("sequence") as? String ?: error("Sequence must be a string")
            val n = cursor(seq)
            require(n > previous) { "Arrivals are out of order" }; previous = n
            Entry(seq, DevicePolicy.id(row.getString("itemId")))
        }
        val next = json.get("nextCursor") as? String ?: error("Cursor must be a string")
        require(cursor(next) == previous) { "Unexpected arrival cursor" }
        val more = json.getBoolean("hasMore")
        require(!more || entries.isNotEmpty()) { "Empty catch-up page" }
        return Page(entries, next, ack, more)
    }

    /** Posting and preference commit cannot be atomic. Stable IDs make replay replace a banner. */
    fun process(page: Page, processed: String?, postBatch: (Entry) -> Unit, persist: (String) -> Unit, ack: (String) -> Unit) {
        val old = processed?.let(::cursor)
        val next = cursor(page.next)
        require(old == null || next >= old) { "Arrival cursor moved backward" }
        if (page.entries.isNotEmpty() && (old == null || next > old)) {
            postBatch(page.entries.last())
            persist(page.next)
        }
        // Even empty responses return a server-issued cursor; never invent one.
        ack(page.next)
    }
    fun permission(runtimeGranted: Boolean, asked: Boolean, appAllowed: Boolean, channelAllowed: Boolean): String = when {
        !runtimeGranted -> if (asked) "denied" else "prompt"
        !appAllowed || !channelAllowed -> "denied"
        else -> "granted"
    }
}

/** Shared by the visible timer and JobService. Cancellation never stops somebody else's run. */
class ArrivalFlight {
    class Ticket {
        private val cancelled = AtomicBoolean(false)
        @Volatile var cancelIo: (() -> Unit)? = null
            set(value) { field = value; if (cancelled.get()) value?.invoke() }
        fun check() { check(!cancelled.get()) { "Arrival check stopped" } }
        fun cancel() { cancelled.set(true); cancelIo?.invoke() }
    }
    private var active: Ticket? = null
    @Synchronized fun begin(): Ticket? = if (active != null) null else Ticket().also { active = it }
    @Synchronized fun finish(ticket: Ticket) { if (active === ticket) active = null }
    @Synchronized fun stop() { active?.cancel() }
    @Synchronized fun <T> guard(block: () -> T): T = block()
    @Synchronized fun <T> current(ticket: Ticket, block: () -> T): T {
        check(active === ticket); ticket.check(); return block()
    }
}

/** Commit/consume failures do not report a successful notification handoff. */
class ArrivalTargetStore(private val read: () -> Pair<String, String>, private val write: (Pair<String, String>?) -> Unit) {
    fun save(paired: String, connected: Boolean, base: String, item: String): Boolean {
        if (!connected || !ArrivalPolicy.target(paired, base, item)) return false
        write(DevicePolicy.origin(paired) to item)
        return true
    }
    fun take(paired: String, connected: Boolean): Pair<String, String>? {
        val (base, item) = read()
        val result = if (connected && ArrivalPolicy.target(paired, base, item)) DevicePolicy.origin(paired) to item else null
        write(null)
        return result
    }
}
