package household.share.android

import org.junit.Assert.*
import org.junit.Test

class NativeHttpTest {
    @Test fun malformedUtf8IsRejectedInsteadOfRepairingCopiedText() {
        listOf(
            listOf(0xc3, 0x28), listOf(0x80), listOf(0xf0, 0x9f, 0x98),
            listOf(0xc0, 0xaf), listOf(0xed, 0xa0, 0x80), listOf(0xf4, 0x90, 0x80, 0x80), listOf(0xff),
        ).forEach { invalid ->
            try { NativeHttp.decodeUtf8(invalid.map(Int::toByte).toByteArray()); fail("Malformed UTF-8 was repaired") }
            catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("not valid UTF-8")) }
        }
    }

    @Test fun bomAndWhitespaceRemainExactIncludingBomOnlyAndEmptyText() {
        listOf("", "\uFEFF", "\uFEFF \tfirst\r\nlast\n\n ").forEach { original ->
            assertEquals(original, NativeHttp.decodeUtf8(original.toByteArray(Charsets.UTF_8)))
        }
    }

    @Test fun exactUnicodeIncludingReplacementCodePointIsNotNormalized() {
        val original = "\tCafe\u0301 café 中文 😃 \u0000 \uFFFD\r\n"
        val bytes = original.toByteArray(Charsets.UTF_8)
        val decoded = NativeHttp.decodeUtf8(bytes)
        assertEquals(original, decoded)
        assertArrayEquals(bytes, decoded.toByteArray(Charsets.UTF_8))
    }
}
