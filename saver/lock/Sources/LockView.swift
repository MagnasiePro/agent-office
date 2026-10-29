import AppKit
import WebKit

/// One display's lock screen: the Agent Office scene, a clock, and (primary display only) the unlock panel,
/// which appears on mouse/keyboard activity and hides again after a while.
@MainActor
final class LockView: NSView, WKNavigationDelegate, NSTextFieldDelegate {
    private let url: URL
    private weak var controller: LockController?
    private let webView: WKWebView
    private let clock = NSTextField(labelWithString: "")
    private let offline = NSTextField(labelWithString: "")
    private var panel: NSView?
    private let field = NSSecureTextField()
    private let message = NSTextField(labelWithString: "")
    private var clockTimer: Timer?
    private var hideTimer: Timer?
    private var retry: DispatchWorkItem?

    init(url: URL, showsUnlock: Bool, controller: LockController) {
        self.url = url
        self.controller = controller
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(frame: .zero)
        wantsLayer = true

        webView.setValue(false, forKey: "drawsBackground")
        webView.setValue(false, forKey: "windowOcclusionDetectionEnabled")
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        addSubview(webView)

        offline.stringValue = "Agent Office scene not reachable at \(url.absoluteString)"
        offline.textColor = NSColor.white.withAlphaComponent(0.45)
        offline.font = .systemFont(ofSize: 13)
        offline.isHidden = true
        addSubview(offline)

        clock.font = .monospacedDigitSystemFont(ofSize: 15, weight: .regular)
        clock.textColor = NSColor.white.withAlphaComponent(0.55)
        clock.shadow = { let s = NSShadow(); s.shadowBlurRadius = 6; s.shadowColor = .black; return s }()
        addSubview(clock)

        if showsUnlock { buildPanel() }
        tick()
        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        load()
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        webView.frame = bounds
        clock.sizeToFit()
        clock.setFrameOrigin(NSPoint(x: 28, y: 24))
        offline.sizeToFit()
        offline.setFrameOrigin(NSPoint(x: (bounds.width - offline.frame.width) / 2, y: bounds.height / 2))
        if let panel {
            let size = panel.fittingSize
            panel.frame = NSRect(x: (bounds.width - size.width) / 2, y: 56, width: size.width, height: size.height)
        }
    }

    /// The scene is for looking only: every click lands on the lock view (or the panel), never in the page.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        if let hit, hit === webView || hit.isDescendant(of: webView) { return self }
        return hit
    }

    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            clockTimer?.invalidate()
            hideTimer?.invalidate()
            retry?.cancel()
            webView.stopLoading()
        }
    }

    private func tick() {
        let f = DateFormatter()
        f.dateFormat = "EEEE d MMMM  HH:mm"
        clock.stringValue = f.string(from: Date())
        needsLayout = true
    }

    // MARK: scene

    private func load() {
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5))
    }

    private func failed() {
        offline.isHidden = false
        retry?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.load() }
        retry = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: item)
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { offline.isHidden = true }
    }
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failed() }
    }
    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failed() }
    }
    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        MainActor.assumeIsolated { failed() }
    }

    // MARK: unlock panel

    private var hint: String { controller?.hasTouchID == true ? "Touch ID or password" : "Enter your password" }

    /// Minimal, bottom-centred: name, a translucent pill password field, one caption line (hint, or the error).
    private func buildPanel() {
        let p = NSView()
        p.wantsLayer = true
        p.isHidden = true

        let name = NSTextField(labelWithString: NSFullUserName())
        name.font = .systemFont(ofSize: 13, weight: .semibold)
        name.textColor = NSColor.white.withAlphaComponent(0.85)
        name.alignment = .center

        let pill = NSVisualEffectView()
        pill.material = .hudWindow
        pill.blendingMode = .withinWindow
        pill.state = .active
        pill.wantsLayer = true
        pill.layer?.cornerRadius = 17
        pill.layer?.borderWidth = 1
        pill.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
        pill.translatesAutoresizingMaskIntoConstraints = false

        field.placeholderAttributedString = NSAttributedString(string: "Password", attributes: [
            .foregroundColor: NSColor.white.withAlphaComponent(0.4), .font: NSFont.systemFont(ofSize: 13),
        ])
        field.font = .systemFont(ofSize: 13)
        field.textColor = .white
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.delegate = self
        field.target = self
        field.action = #selector(submit)
        field.translatesAutoresizingMaskIntoConstraints = false

        let glyph = NSImageView(image: NSImage(systemSymbolName: controller?.hasTouchID == true ? "touchid" : "arrow.right.circle", accessibilityDescription: nil)!)
        glyph.symbolConfiguration = .init(pointSize: 15, weight: .regular)
        glyph.contentTintColor = NSColor.white.withAlphaComponent(0.5)
        glyph.translatesAutoresizingMaskIntoConstraints = false

        pill.addSubview(field)
        pill.addSubview(glyph)
        NSLayoutConstraint.activate([
            pill.widthAnchor.constraint(equalToConstant: 240),
            pill.heightAnchor.constraint(equalToConstant: 34),
            field.leadingAnchor.constraint(equalTo: pill.leadingAnchor, constant: 16),
            field.trailingAnchor.constraint(equalTo: glyph.leadingAnchor, constant: -8),
            field.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
            glyph.trailingAnchor.constraint(equalTo: pill.trailingAnchor, constant: -11),
            glyph.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
        ])

        message.font = .systemFont(ofSize: 11)
        message.alignment = .center
        resetMessage()

        let stack = NSStackView(views: [name, pill, message])
        stack.orientation = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        p.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: p.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: p.trailingAnchor),
            stack.topAnchor.constraint(equalTo: p.topAnchor),
            stack.bottomAnchor.constraint(equalTo: p.bottomAnchor),
        ])
        addSubview(p)
        panel = p
    }

    private func resetMessage() {
        message.stringValue = hint
        message.textColor = NSColor.white.withAlphaComponent(0.5)
    }

    /// Typing again clears the last error.
    func controlTextDidChange(_ obj: Notification) { resetMessage() }

    /// Any activity shows the panel and focuses the field, so the first key typed already goes into it.
    func userActivity(_ event: NSEvent) {
        guard let panel else { return }
        if event.type == .keyDown, event.keyCode == 53 { hidePanel(); return } // Esc
        if panel.isHidden {
            panel.alphaValue = 0
            panel.isHidden = false
            needsLayout = true
            NSAnimationContext.runAnimationGroup { $0.duration = 0.2; panel.animator().alphaValue = 1 }
        }
        // No-op while armed; re-arms after a cancelled prompt even if the panel stayed up.
        controller?.armTouchID()
        if window?.firstResponder !== field.currentEditor() {
            window?.makeKey()
            window?.makeFirstResponder(field)
        }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.hidePanel() } }
    }

    private func hidePanel() {
        hideTimer?.invalidate()
        panel?.isHidden = true
        field.stringValue = ""
        resetMessage()
        window?.makeFirstResponder(self)
        NSCursor.setHiddenUntilMouseMoves(true)
    }

    @objc private func submit() {
        let password = field.stringValue
        guard !password.isEmpty else { return }
        field.isEnabled = false
        controller?.attempt(password: password) { [weak self] error in
            guard let self else { return }
            self.field.isEnabled = true
            self.field.stringValue = ""
            if let error {
                self.message.stringValue = error
                self.message.textColor = NSColor(srgbRed: 1, green: 0.55, blue: 0.55, alpha: 1)
                self.window?.makeFirstResponder(self.field)
                self.shake()
            }
        }
    }

    private func shake() {
        guard let layer = panel?.layer else { return }
        let a = CAKeyframeAnimation(keyPath: "transform.translation.x")
        a.values = [0, -10, 10, -8, 8, -4, 4, 0]
        a.duration = 0.4
        layer.add(a, forKey: "shake")
    }
}
