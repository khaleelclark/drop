package household.share.android

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
        // Preserve WebView/system text scaling, selection, scrolling, focus and IME handling.
        // Do not override textZoom or intercept touch events to suppress page zoom.
    }
}
