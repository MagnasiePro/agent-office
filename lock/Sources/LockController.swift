import AppKit
@preconcurrency import LocalAuthentication
import OpenDirectory

/// Covers every display at the shielding window level, switches the app to kiosk mode
/// (no Cmd-Tab, Force Quit, Dock, menu bar, log out) and unlocks with Touch ID or the login password.
@MainActor
final class LockController {
    private(set) var isLocked = false
    /// Debug safety net (`--test-unlock-after N`): unlocks by itself after N seconds.
    var testUnlockAfter: Double?

    private var windows: [LockWindow] = []
    private var observers: [Any] = []
    private var eventMonitor: Any?
    private var touchID: LAContext?
    private let blocker = InputBlocker()
    private var failures = 0
    private var cooldownUntil = Date.distantPast

    private static let kiosk: NSApplication.PresentationOptions = [
        .hideDock, .hideMenuBar, .disableProcessSwitching, .disableForceQuit,
        .disableSessionTermination, .disableHideApplication, .disableAppleMenu,
    ]

    func lock() {
        guard !isLocked else { return }
        isLocked = true
        NSApp.setActivationPolicy(.regular)
        NSApp.presentationOptions = Self.kiosk
        buildWindows()
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.setHiddenUntilMouseMoves(true)

        let nc = NotificationCenter.default
        observers = [
            nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.buildWindows() }
            },
            // Something stole focus (a system alert…): take it back.
            nc.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reassert() }
            },
        ]
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .rightMouseDown, .keyDown, .scrollWheel]) { [weak self] event in
            MainActor.assumeIsolated { self?.primaryView?.userActivity(event) }
            return event
        }
        blocker.start()
        armTouchID()
        if let s = testUnlockAfter {
            DispatchQueue.main.asyncAfter(deadline: .now() + s) { [weak self] in self?.unlock() }
        }
    }

    private func unlock() {
        guard isLocked else { return }
        isLocked = false
        blocker.stop()
        touchID?.invalidate()
        touchID = nil
        failures = 0
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        if let m = eventMonitor { NSEvent.removeMonitor(m) }
        eventMonitor = nil
        windows.forEach { $0.close() }
        windows = []
        NSApp.presentationOptions = []
        NSApp.setActivationPolicy(.accessory)
        NSApp.hide(nil)
    }

    private var primaryView: LockView? { windows.first?.contentView as? LockView }

    private func buildWindows() {
        windows.forEach { $0.close() }
        let url = URL(string: UserDefaults.standard.string(forKey: "sceneURL") ?? "") ?? URL(string: "http://localhost:4317/")!
        windows = NSScreen.screens.enumerated().map { i, screen in
            let w = LockWindow(screen: screen)
            w.contentView = LockView(url: url, showsUnlock: i == 0, controller: self)
            w.makeKeyAndOrderFront(nil)
            return w
        }
        windows.first?.makeKey()
    }

    private func reassert() {
        guard isLocked else { return }
        NSApp.activate(ignoringOtherApps: true)
        windows.forEach { $0.orderFrontRegardless() }
        windows.first?.makeKey()
    }

    // MARK: Touch ID

    /// Kept armed while locked so a fingerprint unlocks without clicking anything (the system prompt sits behind the overlay).
    func armTouchID() {
        guard isLocked, touchID == nil else { return }
        let ctx = LAContext()
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return }
        touchID = ctx
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "unlock Agent Office") { ok, error in
            Task { @MainActor in
                guard self.touchID === ctx, self.isLocked else { return }
                self.touchID = nil
                if ok { self.unlock(); return }
                // Retry on its own only for transient failures; a user cancel waits for the next activity on the lock screen.
                switch (error as? LAError)?.code {
                case .authenticationFailed?, .systemCancel?:
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.armTouchID() }
                default:
                    break
                }
            }
        }
    }

    var hasTouchID: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) }

    // MARK: password

    /// Checks the login password through Open Directory; 3 failures → 30 s cooldown. Calls back with an error message, or nil on success.
    func attempt(password: String, completion: @escaping (String?) -> Void) {
        let wait = cooldownUntil.timeIntervalSinceNow
        if wait > 0 { completion("Too many attempts. Try again in \(Int(wait.rounded(.up))) s."); return }
        Task.detached(priority: .userInitiated) {
            let ok = Self.verify(password)
            await MainActor.run {
                guard self.isLocked else { return }
                if ok { completion(nil); self.unlock(); return }
                self.failures += 1
                if self.failures >= 3 {
                    self.failures = 0
                    self.cooldownUntil = Date().addingTimeInterval(30)
                    completion("Too many attempts. Try again in 30 s.")
                } else {
                    completion("Incorrect password.")
                }
            }
        }
    }

    nonisolated static func verify(_ password: String) -> Bool {
        do {
            let node = try ODNode(session: ODSession.default(), type: ODNodeType(kODNodeTypeAuthentication))
            let record = try node.record(withRecordType: kODRecordTypeUsers, name: NSUserName(), attributes: nil)
            try record.verifyPassword(password)
            return true
        } catch {
            return false
        }
    }
}

final class LockWindow: NSWindow {
    init(screen: NSScreen) {
        super.init(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        setFrame(screen.frame, display: false)
        level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        backgroundColor = NSColor(srgbRed: 0x11 / 255, green: 0x0D / 255, blue: 0x1A / 255, alpha: 1)
        isOpaque = true
        hasShadow = false
        isReleasedWhenClosed = false
        acceptsMouseMovedEvents = true
        animationBehavior = .none
        appearance = NSAppearance(named: .darkAqua) // white caret and placeholder in the password field
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
