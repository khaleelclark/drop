package household.share.android

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ApiCallsTest {
    private fun call() = OkHttpClient().newCall(Request.Builder().url("http://127.0.0.1/").build())
    @Test fun abortBeforeSocketRegistrationCancelsTheQueuedRequest() {
        val id = UUID.randomUUID().toString(); val c = call()
        val epoch = ApiCalls.epoch()
        ApiCalls.cancel(id); ApiCalls.register(id, c, epoch)
        assertTrue(c.isCanceled()); ApiCalls.finish(id, c)
    }
    @Test fun abortCancelsAnAlreadyRegisteredSocket() {
        val id = UUID.randomUUID().toString(); val c = call()
        ApiCalls.register(id, c, ApiCalls.epoch()); assertFalse(c.isCanceled())
        ApiCalls.cancel(id); assertTrue(c.isCanceled()); ApiCalls.finish(id, c)
    }
    @Test fun disconnectInvalidatesRequestsThatHadNotRegisteredYet() {
        val epoch = ApiCalls.epoch(); val id = UUID.randomUUID().toString(); val c = call()
        ApiCalls.cancelAll(); ApiCalls.register(id, c, epoch)
        assertTrue(c.isCanceled()); ApiCalls.finish(id, c)
    }
    @Test fun disconnectCancelsActiveSocketsAndReconnectAllowsANewGeneration() {
        val oldId = UUID.randomUUID().toString(); val old = call()
        ApiCalls.register(oldId, old, ApiCalls.epoch()); ApiCalls.cancelAll(); assertTrue(old.isCanceled())
        val newId = UUID.randomUUID().toString(); val next = call()
        ApiCalls.register(newId, next, ApiCalls.epoch()); assertFalse(next.isCanceled())
        ApiCalls.finish(oldId, old); ApiCalls.finish(newId, next)
    }
}
