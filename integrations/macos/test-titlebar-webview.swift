// Capture the composited NSWindow: a WKWebView-only snapshot cannot see a native overlay.
import AppKit
import WebKit

@_silgen_name("drop_style_titlebar")
func styleTitlebar(_ window: UnsafeMutableRawPointer) -> Int32

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

final class ClickThroughOverlay: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class TitlebarRegression {
    let output: URL
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 620),
                        configuration: {
                            let config = WKWebViewConfiguration()
                            config.websiteDataStore = .nonPersistent()
                            return config
                        }())
    let window = NSWindow(contentRect: NSRect(x: 60, y: 60, width: 900, height: 620),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
    var checks: [[String: Any]] = []

    init(_ output: URL) {
        self.output = output
        web.autoresizingMask = [.width, .height]
        window.contentView = web
        window.title = "Drop"
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func settle(_ seconds: TimeInterval = 0.3) {
        let end = Date(timeIntervalSinceNow: seconds)
        while Date() < end { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)) }
    }

    func require(_ value: Bool, _ name: String) throws {
        checks.append(["name": name, "passed": value])
        print("\(value ? "PASS" : "FAIL") \(name)")
        if !value { throw Failure(name) }
    }

    func evaluate(_ script: String) throws -> Any? {
        var done = false
        var value: Any?
        var failure: Error?
        web.evaluateJavaScript(script) { result, error in
            value = result; failure = error; done = true
        }
        let end = Date(timeIntervalSinceNow: 10)
        while !done && Date() < end { settle(0.01) }
        guard done else { throw Failure("WebKit evaluation timed out") }
        if let failure = failure { throw failure }
        return value
    }

    func capture(_ name: String) throws -> NSBitmapImageRep {
        window.displayIfNeeded()
        settle()
        let url = output.appendingPathComponent(name + ".png")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-o", "-l\(window.windowNumber)", url.path]
        try process.run()
        let end = Date(timeIntervalSinceNow: 10)
        while process.isRunning && Date() < end { settle(0.01) }
        guard !process.isRunning else { process.terminate(); throw Failure("Window capture timed out") }
        guard process.terminationStatus == 0,
              let image = NSBitmapImageRep(data: try Data(contentsOf: url)) else {
            throw Failure("Composited window capture unavailable; GUI/capture permission is required")
        }
        return image
    }

    func matches(_ image: NSBitmapImageRep, point: NSPoint, rgb: [CGFloat]) -> Bool {
        let x = Int(point.x / window.frame.width * CGFloat(image.pixelsWide))
        let y = Int((window.frame.height - point.y) / window.frame.height * CGFloat(image.pixelsHigh))
        guard x >= 0, y >= 0, x < image.pixelsWide, y < image.pixelsHigh,
              let c = image.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { return false }
        return abs(c.redComponent - rgb[0]) < 0.10 && abs(c.greenComponent - rgb[1]) < 0.10 &&
               abs(c.blueComponent - rgb[2]) < 0.10 && c.alphaComponent > 0.9
    }

    func contentVisible(_ image: NSBitmapImageRep, rgb: [CGFloat]) -> Bool {
        for x in [CGFloat(0.2), 0.5, 0.8] {
            for y in [CGFloat(0.2), 0.5, 0.8] {
                if !matches(image, point: web.convert(NSPoint(x: web.bounds.width * x,
                                                              y: web.bounds.height * y), to: nil), rgb: rgb) { return false }
            }
        }
        return true
    }

    func run() throws {
        web.loadHTMLString("""
        <!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <style>html,body{margin:0;width:100%;height:100%;background:#147ad6}html[data-theme=dark],html[data-theme=dark] body{background:#142e52}</style>
        <body>Drop web content</body>
        """, baseURL: nil)
        let deadline = Date(timeIntervalSinceNow: 10)
        var loaded = false
        repeat {
            settle(0.05)
            loaded = (try? evaluate("document.readyState === 'complete' && document.body.textContent.includes('Drop web content')")) as? Bool == true
        } while !loaded && Date() < deadline
        try require(loaded, "Actual WKWebView loaded the inert offline fixture")
        guard let screen = window.screen else { throw Failure("Active GUI display is required") }
        let maxSize = screen.visibleFrame.size
        for theme in ["light", "dark"] {
            web.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
            _ = try evaluate("document.documentElement.dataset.theme='\(theme)'")
            let rgb: [CGFloat] = theme == "dark" ? [20/255, 46/255, 82/255] : [20/255, 122/255, 214/255]
            let appearance = web.effectiveAppearance.name
            let windowAppearance = window.appearance
            let themeBefore = try evaluate("getComputedStyle(document.documentElement).backgroundColor") as? String
            try require(contentVisible(try capture("\(theme)-before"), rgb: rgb), "\(theme): baseline window capture sees WebKit pixels")
            for (index, size) in [NSSize(width: 900, height: 620), NSSize(width: 640, height: 480), NSSize(width: 1000, height: 680)].enumerated() {
                window.setContentSize(NSSize(width: min(size.width, maxSize.width - 40), height: min(size.height, maxSize.height - 80)))
                window.center()
                // Repeated styling must also be safe and must not accumulate native views.
                try require(styleTitlebar(Unmanaged.passUnretained(window).toOpaque()) == 1, "\(theme)/\(index): production titlebar styling succeeded")
                let image = try capture("\(theme)-styled-\(index)")
                try require(contentVisible(image, rgb: rgb), "\(theme)/\(index): nine composited WebKit probes remain visible after style/resize")
                let layout = window.contentLayoutRect
                let titlePoint = NSPoint(x: window.frame.width * 0.75, y: (layout.maxY + window.frame.height) / 2)
                try require(matches(image, point: titlePoint, rgb: [180/255, 35/255, 54/255]), "\(theme)/\(index): title strip is red")
                try require(window.contentView === web && web.effectiveAppearance.name == appearance && window.appearance === windowAppearance,
                            "\(theme)/\(index): native content identity and appearance unchanged")
                let themeAfter = try evaluate("getComputedStyle(document.documentElement).backgroundColor") as? String
                try require(themeAfter == themeBefore, "\(theme)/\(index): web theme unchanged")
                try require(window.title == "Drop" && window.titleVisibility == .visible &&
                            [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].allSatisfy { window.standardWindowButton($0)?.isHidden == false },
                            "\(theme)/\(index): native title and traffic lights retained")
            }
        }
        // A click-through overlay can pass hit testing while hiding every content pixel.
        let overlay = ClickThroughOverlay(frame: web.bounds)
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor(srgbRed: 180/255, green: 35/255, blue: 54/255, alpha: 1).cgColor
        web.addSubview(overlay)
        defer { overlay.removeFromSuperview() }
        try require(!contentVisible(try capture("negative-control-overlay"), rgb: [20/255, 46/255, 82/255]),
                    "Pixel oracle rejects an opaque native overlay (negative control)")
    }
}

guard CommandLine.arguments.count == 2 else { fputs("Expected output directory\n", stderr); exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.finishLaunching()
let test = TitlebarRegression(URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
var failure: String?
do { try test.run() } catch { failure = String(describing: error); fputs("FAIL: \(error)\n", stderr) }
let receipt: [String: Any] = ["passed": failure == nil, "checks": test.checks,
                               "error": failure ?? "", "kind": "native composited NSWindow + WKWebView pixels; synthetic offline fixture"]
do {
    try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
        .write(to: test.output.appendingPathComponent("receipt.json"), options: .atomic)
} catch { fputs("Could not save receipt: \(error)\n", stderr); exit(1) }
test.window.close()
exit(failure == nil ? 0 : 1)
