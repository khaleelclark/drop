package household.share.android

import okhttp3.Call

/** Socket cancellation also covers abort-before-start and disconnect racing with registration. */
object ApiCalls {
    private val calls = mutableMapOf<String, Call>()
    private val cancelled = linkedSetOf<String>()
    private var generation = 0L
    @Synchronized fun epoch() = generation
    @Synchronized fun register(id: String, call: Call, expectedEpoch: Long) {
        require(id.length in 1..128) { "Request ID must contain 1 to 128 characters" }
        require(!calls.containsKey(id)) { "Request ID is already active" }
        calls[id] = call
        if (expectedEpoch != generation || cancelled.remove(id)) call.cancel()
    }
    @Synchronized fun finish(id: String, call: Call) {
        if (calls[id] === call) calls.remove(id)
        cancelled.remove(id)
    }
    @Synchronized fun cancel(id: String) {
        require(id.length in 1..128) { "Request ID must contain 1 to 128 characters" }
        if (cancelled.size >= 256) cancelled.remove(cancelled.first())
        cancelled.add(id)
        calls[id]?.cancel()
    }
    @Synchronized fun cancelAll() {
        generation++
        calls.values.forEach { it.cancel() }
    }
}
