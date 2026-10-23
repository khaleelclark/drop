package household.share.android

import android.graphics.Rect
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.webkit.WebView

/** Shared by the standalone Activity and the actual WebView supplied to the Tauri plugin. */
object AppWebViewPolicy {
    /** Call on the UI thread. Let the responsive document determine its CSS viewport. */
    fun apply(webView: WebView) {
        webView.settings.apply {
            // Honor width=device-width/initial-scale=1 instead of a desktop layout viewport.
            useWideViewPort = true
            // Overflow is a layout bug; do not shrink the entire page to conceal it.
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }
        // Zero uses the document viewport and Android density, not a physical-pixel percentage.
        webView.setInitialScale(0)
        if (webView.getTag(R.id.household_system_bar_space) == null) {
            val space = SystemBarSpace(webView)
            webView.setTag(R.id.household_system_bar_space, space)
            webView.addOnAttachStateChangeListener(space)
            if (webView.isAttachedToWindow) space.onViewAttachedToWindow(webView)
        }
        // Preserve WebView/system text scaling, selection, scrolling, focus and IME handling.
        // Do not override textZoom or intercept touch events to suppress page zoom.
    }

    // Subtract our previous reservation, retaining space already provided by the parent/window.
    internal fun systemBarOverlap(inset: Int, gap: Int, reserved: Int): Int =
        (inset - gap + reserved).coerceAtLeast(0)

    /** Call on the UI thread after Activity resume; sample current insets on the next draw. */
    fun refreshKeyboardVisibility(webView: WebView) {
        (webView.getTag(R.id.household_system_bar_space) as? SystemBarSpace)?.refreshKeyboardVisibility()
    }

    internal class KeyboardVisibilitySignal {
        private var previous: Boolean? = null
        private var refresh = true

        fun refresh() { refresh = true }

        fun script(visible: Boolean?): String? {
            if (visible == null || (!refresh && visible == previous)) return null
            previous = visible
            refresh = false
            return "window.dispatchEvent(new CustomEvent('household-keyboard-visibility',{detail:{visible:$visible}}));"
        }
    }

    private class SystemBarSpace(private val webView: WebView) :
        View.OnAttachStateChangeListener, ViewTreeObserver.OnPreDrawListener,
        ViewTreeObserver.OnWindowFocusChangeListener {
        private var observer: ViewTreeObserver? = null
        private val keyboard = KeyboardVisibilitySignal()
        private val position = IntArray(2)
        private val rootPosition = IntArray(2)
        private val bars = Rect()
        private var left = 0
        private var top = 0
        private var right = 0
        private var bottom = 0
        private var wasRtl = false

        override fun onViewAttachedToWindow(v: View) {
            observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
            observer?.takeIf { it.isAlive }?.removeOnWindowFocusChangeListener(this)
            observer = v.viewTreeObserver.also {
                it.addOnPreDrawListener(this)
                it.addOnWindowFocusChangeListener(this)
            }
            refreshKeyboardVisibility()
        }

        override fun onViewDetachedFromWindow(v: View) {
            observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
            observer?.takeIf { it.isAlive }?.removeOnWindowFocusChangeListener(this)
            observer = null
        }

        override fun onWindowFocusChanged(hasFocus: Boolean) {
            if (hasFocus) refreshKeyboardVisibility()
        }

        fun refreshKeyboardVisibility() {
            keyboard.refresh()
            webView.requestApplyInsets()
            webView.invalidate()
        }

        override fun onPreDraw(): Boolean {
            val insets = webView.rootWindowInsets ?: return true
            // shortcut: API26–29 have no typed IME visibility; retain web recovery until legacy device evidence.
            val imeVisible = if (Build.VERSION.SDK_INT >= 30) insets.isVisible(WindowInsets.Type.ime()) else null
            keyboard.script(imeVisible)?.let { webView.evaluateJavascript(it, null) }
            val margins = webView.layoutParams as? ViewGroup.MarginLayoutParams ?: return true
            val root = webView.rootView
            if (webView.width == 0 || webView.height == 0) return true
            // Observe instead of replacing inset listeners; IME continues through its existing path.
            if (Build.VERSION.SDK_INT >= 30) {
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                bars.set(safe.left, safe.top, safe.right, safe.bottom)
            } else {
                // Legacy systemWindowInsets includes the keyboard; stable bottom caps it at the bar.
                @Suppress("DEPRECATION")
                bars.set(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight,
                    minOf(insets.systemWindowInsetBottom, insets.stableInsetBottom))
                if (Build.VERSION.SDK_INT >= 28) insets.displayCutout?.let {
                    bars.set(maxOf(bars.left, it.safeInsetLeft), maxOf(bars.top, it.safeInsetTop),
                        maxOf(bars.right, it.safeInsetRight), maxOf(bars.bottom, it.safeInsetBottom))
                }
            }
            root.getLocationInWindow(rootPosition)
            webView.getLocationInWindow(position)
            val rtl = webView.layoutDirection == View.LAYOUT_DIRECTION_RTL
            if (margins.isMarginRelative && rtl != wasRtl) { val swap = left; left = right; right = swap }
            wasRtl = rtl
            val nextLeft = systemBarOverlap(bars.left, position[0] - rootPosition[0], left)
            val nextRight = systemBarOverlap(bars.right, rootPosition[0] + root.width - position[0] - webView.width, right)
            val nextTop = systemBarOverlap(bars.top, position[1] - rootPosition[1], top)
            val nextBottom = systemBarOverlap(bars.bottom, rootPosition[1] + root.height - position[1] - webView.height, bottom)
            if (left == nextLeft && top == nextTop && right == nextRight && bottom == nextBottom) return true
            if (margins.isMarginRelative) {
                margins.marginStart += if (rtl) nextRight - right else nextLeft - left
                margins.marginEnd += if (rtl) nextLeft - left else nextRight - right
            } else {
                margins.leftMargin += nextLeft - left
                margins.rightMargin += nextRight - right
            }
            margins.topMargin += nextTop - top
            margins.bottomMargin += nextBottom - bottom
            left = nextLeft; top = nextTop; right = nextRight; bottom = nextBottom
            webView.layoutParams = margins
            return false
        }
    }
}
