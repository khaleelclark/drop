package household.share.android

import android.content.SharedPreferences
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ConfigStoreTest {
    private val origin = "https://household.example"

    @Test fun genericBuildLeavesFirstRunManualAndWritesNothing() {
        for (default in listOf("", "  ")) {
            val disk = Preferences()
            val config = ConfigStore(disk, default).current()
            assertEquals("", config.baseUrl); assertEquals("", config.deviceId)
            assertEquals("Android", config.sourceDevice)
            assertTrue(disk.values.isEmpty())
        }
    }

    @Test fun firstRunPersistsDefaultAndIdentityWithoutNetwork() {
        val disk = Preferences()
        val config = ConfigStore(disk, "$origin/").current()
        assertEquals(origin, config.baseUrl); assertEquals("", config.token)
        assertEquals("Android", config.sourceDevice); assertTrue(config.connected)
        assertTrue(Regex("[0-9a-f]{32}").matches(config.deviceId))
        assertEquals(origin, disk.values["baseUrl"]); assertEquals("", disk.values["token"])
        assertEquals(true, disk.values["connected"])
        assertEquals(config.deviceId, disk.values["device.${DevicePolicy.key(origin)}"])
        assertFalse(config.redacted().has("token"))
    }

    @Test fun relaunchAndBuildDefaultChangesKeepSavedConfigAndIdentity() {
        val disk = Preferences()
        val first = ConfigStore(disk, origin).current()
        val persisted = disk.values.toMap()
        for (default in listOf(origin, "", "https://other.example", "invalid default")) {
            assertEquals(first, ConfigStore(disk, default).current())
            assertEquals(persisted, disk.values)
        }
    }

    @Test fun existingManualConfigNameTokenAndIdentityWinOverDefault() {
        val disk = Preferences()
        val config = ConfigStore(disk, "").set(JSONObject().put("baseUrl", "https://other.example")
            .put("token", "keep-secret").put("sourceDevice", "Renamed kitchen phone"))
        val persisted = disk.values.toMap()
        assertEquals(config, ConfigStore(disk, origin).current())
        assertEquals(persisted, disk.values)
    }

    @Test fun anySavedConnectionFieldIncludingEmptyValuesPreventsInitialization() {
        for ((key, value) in mapOf("baseUrl" to "", "token" to "", "sourceDevice" to "Keep name", "connected" to true)) {
            val disk = Preferences().apply { values[key] = value }
            val persisted = disk.values.toMap()
            assertEquals("", ConfigStore(disk, origin).current().baseUrl)
            assertEquals(persisted, disk.values)
        }
    }

    @Test fun explicitDisconnectSurvivesRelaunchAndBuildDefaultChanges() {
        val disk = Preferences()
        val store = ConfigStore(disk, origin)
        val first = store.current()
        store.disconnect()
        val persisted = disk.values.toMap()
        for (default in listOf(origin, "https://other.example", "")) {
            val config = ConfigStore(disk, default).current()
            assertFalse(config.connected); assertEquals(first.baseUrl, config.baseUrl)
            assertEquals(first.deviceId, config.deviceId); assertEquals(first.sourceDevice, config.sourceDevice)
            assertEquals("", config.token); assertEquals(persisted, disk.values)
        }
    }

    @Test fun disconnectBeforeAnyConfigurationAlsoPreventsDefaultOnRelaunch() {
        val disk = Preferences()
        ConfigStore(disk, "").disconnect()
        val config = ConfigStore(disk, origin).current()
        assertFalse(config.connected); assertEquals("", config.baseUrl)
        assertEquals(mapOf("connected" to false), disk.values)
    }

    @Test fun invalidDefaultCannotWriteConfigurationOrIdentity() {
        for (default in listOf("http://localhost:4300", "http://household.example", "https://user:secret@household.example",
            "$origin/api", "$origin?token=secret", "$origin#fragment", "//household.example", "not an origin")) {
            val disk = Preferences()
            assertThrows(Exception::class.java) { ConfigStore(disk, default).current() }
            assertTrue(disk.values.isEmpty())
        }
    }

    @Test fun failedIdentityCommitNeverReturnsAnEphemeralDefault() {
        val disk = Preferences().apply { failCommit = { true } }
        assertThrows(IllegalStateException::class.java) { ConfigStore(disk, origin).current() }
        assertTrue(disk.values.isEmpty())
    }

    @Test fun failedConfigCommitCanRetryWithTheAlreadyPersistedIdentity() {
        val disk = Preferences().apply { failCommit = { "baseUrl" in it } }
        assertThrows(IllegalArgumentException::class.java) { ConfigStore(disk, origin).current() }
        val savedIdentity = disk.values.values.single()
        disk.failCommit = { false }
        val config = ConfigStore(disk, origin).current()
        assertEquals(savedIdentity, config.deviceId); assertTrue(config.connected)
        assertEquals(config, ConfigStore(disk, "").current())
    }

    @Test fun explicitReconnectStillUsesSavedIdentityAndChosenManualSettings() {
        val disk = Preferences()
        val store = ConfigStore(disk, origin)
        val first = store.current()
        store.disconnect()
        val reconnected = ConfigStore(disk, origin).set(JSONObject().put("baseUrl", origin)
            .put("token", "manual-fallback").put("sourceDevice", "User chosen name"))
        assertEquals(first.deviceId, reconnected.deviceId); assertTrue(reconnected.connected)
        assertEquals("manual-fallback", reconnected.token); assertEquals("User chosen name", reconnected.sourceDevice)
    }

    // Exercise ConfigStore's real commits and reads without Android storage or a network dependency.
    private class Preferences : SharedPreferences {
        val values = mutableMapOf<String, Any?>()
        var failCommit: (Map<String, Any?>) -> Boolean = { false }
        override fun contains(key: String) = values.containsKey(key)
        override fun getAll(): Map<String, *> = values.toMap()
        override fun getString(key: String, defValue: String?): String? = values[key] as String? ?: defValue
        override fun getBoolean(key: String, defValue: Boolean) = values[key] as Boolean? ?: defValue
        override fun getInt(key: String, defValue: Int) = values[key] as Int? ?: defValue
        override fun getLong(key: String, defValue: Long) = values[key] as Long? ?: defValue
        override fun getFloat(key: String, defValue: Float) = values[key] as Float? ?: defValue
        override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = error("Not used")
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = Unit
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = Unit
        override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
            private val pending = mutableMapOf<String, Any?>()
            private var clear = false
            override fun putString(key: String, value: String?) = apply { pending[key] = value }
            override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
            override fun putInt(key: String, value: Int) = apply { pending[key] = value }
            override fun putLong(key: String, value: Long) = apply { pending[key] = value }
            override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
            override fun putStringSet(key: String, value: MutableSet<String>?) = error("Not used")
            override fun remove(key: String) = apply { pending[key] = null }
            override fun clear() = apply { clear = true }
            override fun commit(): Boolean {
                if (failCommit(pending)) return false
                if (clear) values.clear()
                pending.forEach { (key, value) -> if (value == null) values.remove(key) else values[key] = value }
                return true
            }
            override fun apply() { check(commit()) }
        }
    }
}
