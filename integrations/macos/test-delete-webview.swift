// Synthetic fixture + native AppKit input; run via test-delete-webview.sh.
import AppKit
import WebKit

struct DiagnosticError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

final class DeleteDiagnostic: NSObject, WKNavigationDelegate {
    let origin: URL
    let mode: String
    let output: URL
    let web: WKWebView
    let window: NSWindow
    var scenario = ""
    var checks: [[String: Any]] = []
    var cases: [[String: Any]] = []
    var checkpoints: [[String: Any]] = []
    var warnings: [String] = []
    var navigationErrors: [String] = []
    var infrastructureErrors: [String] = []
    var eventNumber = 0

    init(origin: URL, mode: String, output: URL, fixture: String) {
        self.origin = origin
        self.mode = mode
        self.output = output
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(source: fixture, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 800), configuration: configuration)
        web = view
        window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        super.init()
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        window.contentView = web
        window.title = "Zing — synthetic Delete diagnostic"
        window.acceptsMouseMovedEvents = true
        window.setContentSize(NSSize(width: 1100, height: 800))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(web)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let allowed = url?.scheme == origin.scheme && url?.host == origin.host && url?.port == origin.port
        if !allowed { navigationErrors.append("Blocked navigation outside diagnostic loopback origin") }
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationErrors.append("Provisional navigation: \(error.localizedDescription)")
    }

    // Pump the main run loop so AppKit and the separate WebKit process can respond.
    func settle(_ seconds: TimeInterval = 0.25) {
        let deadline = Date(timeIntervalSinceNow: seconds)
        while Date() < deadline { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)) }
    }

    func evaluate(_ script: String) throws -> Any {
        var finished = false
        var value: Any = NSNull()
        var failure: Error?
        web.evaluateJavaScript(script) { result, error in
            value = result ?? NSNull()
            failure = error
            finished = true
        }
        let deadline = Date(timeIntervalSinceNow: 10)
        while !finished && Date() < deadline { settle(0.01) }
        guard finished else { throw DiagnosticError("Timed out evaluating diagnostic JavaScript") }
        if let failure = failure { throw failure }
        return value
    }

    func object(_ expression: String) throws -> [String: Any] {
        guard let json = try evaluate("JSON.stringify(\(expression))") as? String,
              let data = json.data(using: .utf8),
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DiagnosticError("Expected diagnostic JSON object")
        }
        return value
    }

    func waitFor(_ expression: String, timeout: TimeInterval = 5) throws -> Bool {
        let deadline = Date(timeIntervalSinceNow: timeout)
        repeat {
            if (try evaluate("Boolean(\(expression))") as? Bool) == true { return true }
            settle(0.05)
        } while Date() < deadline
        return false
    }

    func check(_ condition: Bool, _ name: String) {
        checks.append(["case": scenario, "name": name, "passed": condition])
        print("\(condition ? "PASS" : "OBSERVED FAILURE") [\(scenario)] \(name)")
    }

    func snapshot() throws -> [String: Any] { try object("window.__deleteDiagnostic.snapshot()") }
    func flag(_ value: [String: Any], _ key: String) -> Bool { value[key] as? Bool == true }
    func count(_ value: [String: Any]) -> Int { (value["deleteCount"] as? NSNumber)?.intValue ?? -1 }
    func visible(_ value: [String: Any], _ key: String) -> Bool {
        guard let rect = value[key] as? [String: Any] else { return false }
        return flag(rect, "visible") && flag(rect, "uncovered")
    }

    func screenshot(_ name: String) {
        var completed = false
        var errorText: String?
        web.takeSnapshot(with: nil) { image, error in
            defer { completed = true }
            guard let image = image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                  let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
                errorText = error?.localizedDescription ?? "No PNG snapshot"
                return
            }
            do { try data.write(to: self.output.appendingPathComponent(name), options: .atomic) }
            catch { errorText = error.localizedDescription }
        }
        let deadline = Date(timeIntervalSinceNow: 5)
        while !completed && Date() < deadline { settle(0.01) }
        if !completed || errorText != nil { warnings.append("Snapshot \(name): \(errorText ?? "timeout")") }
    }

    func checkpoint(_ name: String) throws {
        let image = "\(scenario)-\(checkpoints.count)-\(name).png"
        checkpoints.append(["name": name, "snapshot": try snapshot(), "screenshot": image])
        screenshot(image)
    }

    func placeTarget() throws {
        // Ordinary pre-interaction scrolling only; confirmation visibility is measured before recovery scrolling.
        let scroll = scenario == "last" ? "window.scrollTo(0,document.documentElement.scrollHeight)" : "window.scrollTo(0,0)"
        _ = try evaluate(scroll)
        _ = try evaluate("window.__deleteDiagnostic.find('more')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        settle()
    }

    func click(_ name: String, scroll: Bool = false) throws {
        // Names are fixed harness constants, never user-provided selectors or JavaScript.
        if scroll {
            _ = try evaluate("window.__deleteDiagnostic.find('\(name)')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            settle()
        }
        let rect = try object("window.__deleteDiagnostic.rect(window.__deleteDiagnostic.find('\(name)')) || {}")
        guard flag(rect, "visible"), flag(rect, "uncovered"),
              let x = rect["x"] as? Double, let y = rect["y"] as? Double,
              let width = rect["width"] as? Double, let height = rect["height"] as? Double else {
            throw DiagnosticError("Cannot deliver visible, uncovered native pointer input to \(name)")
        }
        let css = NSPoint(x: x + width / 2, y: y + height / 2)
        let local = NSPoint(x: css.x, y: web.isFlipped ? css.y : web.bounds.height - css.y)
        let location = web.convert(local, to: nil)
        eventNumber += 1
        let start = (try evaluate("window.__deleteDiagnostic.state.events.length") as? NSNumber)?.intValue ?? 0
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: eventNumber, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else {
                throw DiagnosticError("Could not create AppKit mouse event")
            }
            NSApp.sendEvent(event)
            settle(type == .leftMouseDown ? 0.08 : 0.3)
        }
        let trusted = try evaluate("window.__deleteDiagnostic.state.events.slice(\(start)).some(e=>e.type==='mousedown'&&e.trusted)") as? Bool == true
        check(trusted, "AppKit \(name) pointer produced trusted DOM mousedown")
    }

    func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = []) throws {
        let start = (try evaluate("window.__deleteDiagnostic.state.events.length") as? NSNumber)?.intValue ?? 0
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) else {
                throw DiagnosticError("Could not create AppKit key event")
            }
            NSApp.sendEvent(event)
            settle(0.1)
        }
        let trusted = try evaluate("window.__deleteDiagnostic.state.events.slice(\(start)).some(e=>e.type==='keydown'&&e.trusted)") as? Bool == true
        check(trusted, "AppKit key code \(code) produced trusted DOM keydown")
    }

    func openMenu() throws {
        try click("more")
        if mode == "tabindex" {
            // Differential diagnostic only: no focus, event or geometry changes.
            let changed = try object("window.__deleteDiagnostic.applyTabindex()")
            check(flag(changed, "allExplicitZero") && ((changed["count"] as? Int) ?? 0) > 1, "Attribute-only diagnostic sets rendered menu buttons/trigger tabindex=0")
        }
    }

    func openConfirmation() throws -> Bool {
        try placeTarget()
        try openMenu()
        let menu = try snapshot()
        check(visible(menu, "menu"), "Menu opens within viewport")
        try click("action")
        let present = try waitFor("window.__deleteDiagnostic.find('confirmation') !== null", timeout: 2)
        let current = try snapshot()
        check(present, "Pointer Delete item opens confirmation")
        check(visible(current, "confirmation") && visible(current, "keep") && visible(current, "deleteButton"), "Confirmation and both controls are visible without recovery scrolling")
        check(flag(current, "keepFocused"), "Confirmation initially focuses safe Keep control")
        check(count(current) == 0, "Opening confirmation sends no DELETE")
        try checkpoint("confirmation")
        return present
    }

    func exercise(_ name: String) {
        scenario = name
        checkpoints = []
        let firstCheck = checks.count
        var caseError: String?
        do {
            var url = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
            url.queryItems = [URLQueryItem(name: "case", value: name), URLQueryItem(name: "diagnostic", value: mode)]
            web.load(URLRequest(url: url.url!))
            guard try waitFor("window.__deleteDiagnostic?.state.scenario==='\(name)' && window.__deleteDiagnostic.find('more') && window.__deleteDiagnostic.snapshot().queueRows===3", timeout: 20) else {
                throw DiagnosticError("Frontend/three queue rows did not become ready")
            }
            settle(0.5)
            let initial = try snapshot()
            let viewport = initial["viewport"] as? [String: Any] ?? [:]
            // AppKit may constrain the requested window to the runner's available screen.
            check(((viewport["width"] as? Int) ?? 0) >= 320 && ((viewport["height"] as? Int) ?? 0) >= 400, "Actual web viewport is measurable; report records host-constrained dimensions")
            check((initial["queueRows"] as? Int) == 3, "Three synthetic native queue rows rendered")
            try placeTarget()
            try checkpoint("initial")
            if try openConfirmation() {
                // Let the app's actual five-second native poll run, without invoking refresh ourselves.
                settle(5.3)
                let polled = try snapshot()
                check(polled["confirmation"] is [String: Any] && count(polled) == 0, "Native poll retains confirmation without mutation")
                // A baseline can be scrolled to diagnose later stages after its visibility failure was recorded.
                try click("keep", scroll: mode != "fixed")
                let kept = try snapshot()
                check(!(kept["confirmation"] is [String: Any]) && flag(kept, "rowPresent") && count(kept) == 0, "Keep retains item and sends no DELETE")

                try placeTarget()
                try openMenu()
                try key("\u{1b}", code: 53)
                let escaped = try snapshot()
                check(!(escaped["menu"] is [String: Any]) && flag(escaped, "moreFocused"), "Escape dismisses menu and restores trigger focus")
                try openMenu()
                try key("\t", code: 48, modifiers: .shift)
                try key("\t", code: 48, modifiers: .shift)
                check(!((try snapshot())["menu"] is [String: Any]), "Shift+Tab leaves and dismisses menu")
                try openMenu()
                try click("outside", scroll: true)
                let outside = try snapshot()
                check(!(outside["menu"] is [String: Any]) && count(outside) == 0, "Outside pointer dismisses without mutation")
                try checkpoint("dismissals")

                guard try openConfirmation() else { throw DiagnosticError("Confirmation unavailable for failure/retry checks") }
                _ = try evaluate("window.__deleteDiagnostic.state.deleteFailure=true")
                try click("delete", scroll: mode != "fixed")
                _ = try waitFor("window.__deleteDiagnostic.snapshot().errorVisible")
                let failed = try snapshot()
                check(flag(failed, "rowPresent") && failed["confirmation"] is [String: Any] && flag(failed, "errorVisible") && flag(failed, "deleteEnabled") && !flag(failed, "success") && count(failed) == 1, "Structured 500 retains item, visible error and enabled explicit retry without success")
                try checkpoint("delete-500")

                _ = try evaluate("window.__deleteDiagnostic.state.deleteFailure=false;window.__deleteDiagnostic.state.feedFailure=true")
                try click("delete", scroll: mode != "fixed")
                _ = try waitFor("window.__deleteDiagnostic.snapshot().feedError")
                let refreshFailed = try snapshot()
                check(flag(refreshFailed, "success") && flag(refreshFailed, "feedError") && count(refreshFailed) == 2, "Bodyless 204 reports success; failed refresh offers recovery without another DELETE")
                try checkpoint("refresh-failed")
                _ = try evaluate("window.__deleteDiagnostic.state.feedFailure=false")
                try click("retry", scroll: true)
                _ = try waitFor("!window.__deleteDiagnostic.snapshot().rowPresent")
                let recovered = try snapshot()
                check(!flag(recovered, "rowPresent") && !flag(recovered, "feedError") && count(recovered) == 2, "Explicit feed Retry removes deleted item without repeating mutation")
                let bodyless = try evaluate("window.__deleteDiagnostic.state.calls.filter(c=>c.method==='DELETE').every(c=>c.path==='/api/items/'+window.__deleteDiagnostic.state.targetId&&!c.hasBody)") as? Bool == true
                check(bodyless, "Every DELETE uses exact item path and has no body")
                let outcomes = try evaluate("JSON.stringify(window.__deleteDiagnostic.state.calls.filter(c=>c.method==='DELETE').map(c=>c.outcome))") as? String
                check(outcomes == "[500,204]", "Exactly one failed DELETE then one bodyless 204")
                try checkpoint("recovered")
            } else {
                warnings.append("\(name): Later confirmation-dependent checks skipped because pointer activation did not open it")
            }
        } catch {
            caseError = String(describing: error)
            check(false, "Case could not continue: \(caseError!)")
            // An input/setup failure is fatal even in baseline mode; observed UI failures alone are not.
            if checks.count == firstCheck + 1 { infrastructureErrors.append("\(name): \(caseError!)") }
        }
        let report = (try? object("window.__deleteDiagnostic.report()")) ?? [:]
        cases.append(["name": name, "observations": report, "checkpoints": checkpoints, "error": caseError ?? ""])
    }

    func finish() throws -> Int32 {
        check(navigationErrors.isEmpty, "No non-loopback or failed main-frame navigation")
        let failures = checks.filter { $0["passed"] as? Bool == false }.count
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x86_64"
        #endif
        let report: [String: Any] = [
            "mode": mode, "attributeOnlyOverride": mode == "tabindex" ? "Rendered menu buttons/trigger tabindex=0 after native open; no focus/event overrides" : "none", "os": ProcessInfo.processInfo.operatingSystemVersionString, "architecture": architecture,
            "webKitVersion": Bundle(for: WKWebView.self).object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "unknown",
            "environmentFile": "environment.txt", "assetHashesFile": "assets.json", "viewportRequested": ["width": 1100, "height": 800],
            "input": "NSEvent mouseDown/up and keyDown/up sent through NSApplication/NSWindow/WKWebView; no DOM input/focus overrides",
            "scope": "Synthetic bridge and static loopback assets. No real household API, installed Tauri app, credentials or transfer execution.",
            "result": !infrastructureErrors.isEmpty || !navigationErrors.isEmpty ? "infrastructure_failure" : failures == 0 ? "passed" : mode != "fixed" ? "observed_failures" : "failed",
            "failureCount": failures, "checks": checks, "cases": cases, "warnings": warnings,
            "navigationErrors": navigationErrors, "infrastructureErrors": infrastructureErrors
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: output.appendingPathComponent("report.json"), options: .atomic)
        print("Report: \(output.appendingPathComponent("report.json").path); observed failures: \(failures)")
        return !infrastructureErrors.isEmpty || !navigationErrors.isEmpty || (mode == "fixed" && failures > 0) ? 1 : 0
    }
}

let arguments = CommandLine.arguments
if arguments.count != 5 || !["baseline", "tabindex", "fixed"].contains(arguments[2]) {
    fputs("Usage: test-delete-webview http://127.0.0.1:PORT baseline|tabindex|fixed OUTPUT_DIR FIXTURE_JS\n", stderr)
    exit(2)
}
guard let origin = URL(string: arguments[1]), origin.scheme == "http", origin.host == "127.0.0.1", origin.port != nil,
      origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
      origin.path.isEmpty || origin.path == "/" else {
    fputs("Only an explicit loopback static-server origin is allowed\n", stderr)
    exit(2)
}
do {
    let fixture = try String(contentsOfFile: arguments[4], encoding: .utf8)
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.appearance = NSAppearance(named: .aqua)
    app.finishLaunching()
    let diagnostic = DeleteDiagnostic(origin: origin, mode: arguments[2], output: URL(fileURLWithPath: arguments[3], isDirectory: true), fixture: fixture)
    diagnostic.exercise("default")
    diagnostic.exercise("last")
    let result = try diagnostic.finish()
    diagnostic.window.orderOut(nil)
    exit(result)
} catch {
    fputs("Diagnostic infrastructure failed: \(error)\n", stderr)
    exit(1)
}
