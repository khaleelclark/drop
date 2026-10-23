package household.share.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class DeviceRoutingTest {
    private val source = "1".repeat(32)
    private val target = "2".repeat(32)
    @Test fun durableIdentitySurvivesReopenRenameAndNormalizedOrigin() {
        val disk = mutableMapOf<String, String>()
        fun open() = DeviceIdentity({ disk[it] }, { k, v -> disk[k] = v })
        val id = open().forServer("https://Household.example:443/")
        assertTrue(Regex("[0-9a-f]{32}").matches(id))
        assertEquals(id, open().forServer("https://household.example"))
        assertNotEquals(id, open().forServer("https://other.example"))
        assertNotEquals(id, open().forServer("https://household.example:444"))
        assertEquals(3, disk.size)
        assertFalse(disk.toString().contains("Household"))
    }
    @Test fun concurrentFirstUseCommitsOnlyOneIdentity() {
        val disk = mutableMapOf<String, String>()
        var writes = 0
        val pool = Executors.newFixedThreadPool(8)
        val start = CountDownLatch(1)
        try {
            val futures = (1..16).map { pool.submit<String> {
                start.await()
                DeviceIdentity({ disk[it] }, { k, v -> writes++; disk[k] = v }).forServer("https://household.example")
            } }
            start.countDown()
            assertEquals(1, futures.map { it.get(3, TimeUnit.SECONDS) }.distinct().size)
            assertEquals(1, writes)
        } finally { pool.shutdownNow() }
    }
    @Test fun failedIdentityCommitNeverHandsOutAnEphemeralId() {
        assertThrows(IllegalStateException::class.java) {
            DeviceIdentity({ null }, { _, _ -> error("Disk full") }).forServer("https://household.example")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceIdentity({ "corrupt" }, { _, _ -> error("Must not replace an existing identity") }).forServer("https://household.example")
        }
    }
    @Test fun staleBackgroundLabelsRequestCreateOnlyAndAcceptTheCurrentRenamedDevice() {
        var calls = 0
        for (stale in listOf("Old configured name", "Old queued name")) {
            DeviceRegistration.ensure(source, stale) { body ->
                calls++
                val sent = JSONObject(body.toString())
                assertEquals(source, sent.getString("id")); assertEquals("android", sent.getString("platform"))
                assertEquals(stale, sent.getString("label")); assertEquals(true, sent.get("preserveExisting"))
                JSONObject().put("device", JSONObject().put("id", source).put("label", "Renamed kitchen phone").put("platform", "android"))
            }
        }
        assertEquals(2, calls)
    }
    @Test fun routingSurvivesPickerConfigSwitchQueuePersistenceAndRetry() {
        val chosen = JSONObject().put("targetDeviceIds", JSONArray(listOf(target)))
        val captured = SendRouting("https://first.example", "Android", source, DevicePolicy.targets(chosen, source))
        chosen.getJSONArray("targetDeviceIds").put(0, "3".repeat(32))
        val pickerJournal = captured.json().toString()
        val row = SendRouting.from(JSONObject(pickerJournal)).applyTo(Transfer(size = TransferPolicy.MAX_FILE, offset = 999))
        val restored = Transfer.from(JSONObject(row.json().toString()))
        assertEquals("https://first.example", restored.baseUrl)
        assertEquals(source, restored.sourceDeviceId)
        assertEquals(listOf(target), restored.targetDeviceIds)
        assertEquals(TransferPolicy.MAX_FILE, restored.size)
        assertEquals(999L, restored.offset)
        assertEquals(source, UploadRouting.metadata(restored)["sourceDeviceId"])
        assertEquals("[\"$target\"]", UploadRouting.metadata(restored)["targetDeviceIds"])
        assertFalse(restored.json(false).has("targetDeviceIds"))
        assertFalse(restored.json(false).has("baseUrl"))
    }
    @Test fun legacyQueueUpgradeKeepsEveryoneAndExistingProgress() {
        val old = JSONObject().put("id", "legacy").put("name", "large.bin").put("baseUrl", "https://old.example")
            .put("status", "retry_wait").put("size", TransferPolicy.MAX_FILE).put("offset", 9_000_000_000L)
            .put("source", "content://documents/original").put("uploadUrl", "https://old.example/api/uploads/saved")
        val row = Transfer.from(old)
        assertEquals("", row.sourceDeviceId); assertTrue(row.targetDeviceIds.isEmpty())
        assertEquals(9_000_000_000L, row.offset)
        assertEquals("content://documents/original", row.source)
        assertEquals("https://old.example/api/uploads/saved", row.uploadUrl)
        assertFalse(UploadRouting.metadata(row).containsKey("sourceDeviceId"))
        assertFalse(UploadRouting.metadata(row).containsKey("targetDeviceIds"))
        assertEquals(row, Transfer.from(JSONObject(row.json().toString())))
    }
    @Test fun everyoneIsExplicitlyEmptyAndRejectedTargetsNeverBecomeEveryone() {
        assertTrue(DevicePolicy.targets(JSONObject(), source).isEmpty())
        assertTrue(DevicePolicy.targets(JSONObject().put("targetDeviceIds", JSONArray()), source).isEmpty())
        for (value in listOf(JSONArray(listOf(source)), JSONArray(listOf(target, target)), JSONArray(listOf("bad")), JSONArray(listOf(12)), JSONArray((1..65).map { "%032x".format(it + 10) }))) {
            assertThrows(Exception::class.java) { DevicePolicy.targets(JSONObject().put("targetDeviceIds", value), source) }
        }
        assertThrows(Exception::class.java) { DevicePolicy.targets(JSONObject().put("targetDeviceIds", JSONObject.NULL), source) }
        assertThrows(Exception::class.java) { UploadRouting.metadata(Transfer(targetDeviceIds = listOf(target))) }
    }
    @Test fun configIsRedactedAndLabelsAreBoundedInBytes() {
        val result = ConfigStore.Config("https://household.example", "secret", "Kitchen Android", true, source).redacted()
        assertEquals(source, result.getString("deviceId")); assertEquals("android", result.getString("platform"))
        assertFalse(result.toString().contains("secret")); assertFalse(result.has("token"))
        assertEquals("家".repeat(42), DevicePolicy.label("家".repeat(42)))
        for (label in listOf(" ", "a\nb", "家".repeat(43), "a\u007fb")) assertThrows(IllegalArgumentException::class.java) { DevicePolicy.label(label) }
    }
    @Test fun crashOrLostCreationResponseCannotCreateAnotherItemOnRetry() {
        val row = Transfer(baseUrl = "https://household.example", creationPending = true)
        val restored = Transfer.from(JSONObject(row.json().toString()))
        assertThrows(UploadCreationUnknown::class.java) { UploadRouting.requireCreatable(restored) }
        restored.uploadUrl = "https://household.example/api/uploads/known"
        UploadRouting.requireCreatable(restored)
        val legacy = row.json().apply { remove("creationPending") }
        assertFalse(Transfer.from(legacy).creationPending)
        UploadRouting.requireCreatable(Transfer.from(legacy))
    }
}
