package household.share.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppWebViewPolicyTest {
    @Test fun keyboardSignalsInitialStateAndBackDismissalWithoutFocusOrSizeInput() {
        val signal = AppWebViewPolicy.KeyboardVisibilitySignal()
        assertEquals(event(false), signal.script(false))
        assertNull(signal.script(false))
        assertEquals(event(true), signal.script(true))
        assertNull(signal.script(true))
        assertEquals(event(false), signal.script(false))
        assertNull(signal.script(false))
    }

    @Test fun keyboardResumeAndWindowFocusRefreshCurrentStateWithoutTransition() {
        val signal = AppWebViewPolicy.KeyboardVisibilitySignal()
        for (visible in listOf(false, true)) {
            assertEquals(event(visible), signal.script(visible))
            signal.refresh()
            assertEquals(event(visible), signal.script(visible))
            assertNull(signal.script(visible))
        }
    }

    @Test fun unknownKeyboardVisibilityNeverClaimsDismissalOrConsumesRefresh() {
        val signal = AppWebViewPolicy.KeyboardVisibilitySignal()
        assertNull(signal.script(null))
        assertEquals(event(true), signal.script(true))
        assertNull(signal.script(null))
        assertNull(signal.script(true))
        signal.refresh()
        assertNull(signal.script(null))
        assertEquals(event(true), signal.script(true))
        assertEquals(event(false), signal.script(false))
    }

    private fun event(visible: Boolean) =
        "window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:$visible}}));"

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
