package household.share.android

import org.junit.Assert.assertEquals
import org.junit.Test

class AppWebViewPolicyTest {
    @Test fun reservesOnlyOverlapAfterAncestorAndOriginalMarginSpace() {
        assertEquals(64, AppWebViewPolicy.systemBarOverlap(64, 0, 0))
        assertEquals(54, AppWebViewPolicy.systemBarOverlap(64, 10, 0))
        assertEquals(0, AppWebViewPolicy.systemBarOverlap(64, 64, 0))
        assertEquals(0, AppWebViewPolicy.systemBarOverlap(64, 100, 0))
    }

    @Test fun repeatedLayoutsDoNotAccumulateSpace() {
        val reserved = AppWebViewPolicy.systemBarOverlap(64, 10, 0)
        repeat(5) { assertEquals(reserved, AppWebViewPolicy.systemBarOverlap(64, 10 + reserved, reserved)) }
    }

    @Test fun rotationAndHiddenBarsRemoveOldReservationAndUseNewInsets() {
        assertEquals(0, AppWebViewPolicy.systemBarOverlap(0, 64, 64))
        assertEquals(24, AppWebViewPolicy.systemBarOverlap(24, 64, 64))
        assertEquals(48, AppWebViewPolicy.systemBarOverlap(48, 0, 0))
    }

    @Test fun parentResizeForKeyboardDoesNotAddKeyboardHeight() {
        assertEquals(0, AppWebViewPolicy.systemBarOverlap(64, 800, 64))
        assertEquals(0, AppWebViewPolicy.systemBarOverlap(64, 736, 0))
        assertEquals(64, AppWebViewPolicy.systemBarOverlap(64, 0, 0))
    }
}
