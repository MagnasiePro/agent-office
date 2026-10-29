import AppKit
import IOKit.pwr_mgt
import ServiceManagement

/// Menu bar item, hotkey, `agent-office://lock` URL, idle auto-lock, bundled scene server and first-launch setup.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let lock = LockController()
    private let server = SceneServer()
    private var statusItem: NSStatusItem!
    private var hotkey: Hotkey?
    private var shortcut = Shortcut.standard
    private var shortcutOK = false
    private var timer: Timer?
    private var sigterm: DispatchSourceSignal?
    private let defaults = UserDefaults.standard
    private static let idleChoices = [0, 1, 2, 5, 10, 15, 30]

    func applicationWillFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: ["idleMinutes": 5, "sceneURL": "http://localhost:4317/"])
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "lock.display", accessibilityDescription: "Agent Office")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        hotkey = Hotkey { [weak self] in self?.lock.lock() }
        shortcut = Shortcut.load(defaults)
        shortcutOK = hotkey?.register(shortcut) ?? false
        // `pkill`/`kill` skips applicationWillTerminate: stop the bundled server anyway so it isn't orphaned.
        signal(SIGTERM, SIG_IGN)
        sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        sigterm?.setEventHandler { [weak self] in
            self?.server.stop()
            exit(0)
        }
        sigterm?.resume()
        server.ensureRunning()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.server.ensureRunning()
                self?.checkIdle()
            }
        }
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--test-unlock-after"), i + 1 < args.count, let s = Double(args[i + 1]) {
            lock.testUnlockAfter = s
        }
        if args.contains("--lock") {
            lock.lock()
        } else if !defaults.bool(forKey: "setupDone") {
            DispatchQueue.main.async { self.runSetup() }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        lock.isLocked ? .terminateCancel : .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) { server.stop() }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        // Only locking is exposed; there is deliberately no unlock URL.
        guard let s = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let url = URL(string: s) else { return }
        if url.host == "lock" { lock.lock() }
    }

    // MARK: idle

    private func checkIdle() {
        let minutes = defaults.integer(forKey: "idleMinutes")
        guard minutes > 0, !lock.isLocked else { return }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
        guard idle >= Double(minutes * 60), !displaySleepBlocked() else { return }
        lock.lock()
    }

    /// Like the real screen saver: no auto-lock while an app (video, call…) holds a display-sleep assertion.
    private func displaySleepBlocked() -> Bool {
        var status: Unmanaged<CFDictionary>?
        guard IOPMCopyAssertionsStatus(&status) == kIOReturnSuccess,
              let dict = status?.takeRetainedValue() as? [String: Int] else { return false }
        return (dict[kIOPMAssertPreventUserIdleDisplaySleep] ?? 0) > 0
    }

    // MARK: setup

    /// First launch (and menu → Set Up…): Claude Code hooks, open at login, Accessibility for the shortcut blocker.
    @objc private func runSetup() {
        let hooks = NSButton(checkboxWithTitle: "Show my Claude Code sessions in the office (adds hooks to ~/.claude/settings.json)", target: nil, action: nil)
        let login = NSButton(checkboxWithTitle: "Open at login", target: nil, action: nil)
        let access = NSButton(checkboxWithTitle: "Block system shortcuts while locked (asks for Accessibility permission)", target: nil, action: nil)
        for box in [hooks, login, access] { box.state = .on }
        let stack = NSStackView(views: [hooks, login, access])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 540, height: 76)

        let alert = NSAlert()
        alert.messageText = "Set up Agent Office"
        alert.informativeText = "Lock with \(shortcut.display) (change it from the menu) or from the lock icon in the menu bar; it also locks after \(defaults.integer(forKey: "idleMinutes")) min idle. Unlock with Touch ID or your login password."
        alert.icon = NSApp.applicationIconImage
        alert.accessoryView = stack
        alert.addButton(withTitle: "Set Up")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        defaults.set(true, forKey: "setupDone")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        if hooks.state == .on { installHooks(quiet: true) }
        if login.state == .on, SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
        if access.state == .on, !InputBlocker.isTrusted { InputBlocker.requestTrust() }
    }

    @objc private func installHooksFromMenu() { installHooks(quiet: false) }

    /// Quiet: only speaks up on failure.
    private func installHooks(quiet: Bool) {
        let result = server.runScript("claude-hooks", ["install", String(server.port)])
        guard !quiet || !result.ok else { return }
        let alert = NSAlert()
        alert.messageText = result.ok ? "Claude Code hooks installed" : "Couldn't install the Claude Code hooks"
        alert.informativeText = result.output + (result.ok ? "\n\nOpen Claude Code sessions pick them up on their next event." : "")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        // Single characters show as a real key equivalent; other keys (arrows, F-keys…) go in the title.
        let single = shortcut.key.count == 1
        let lockItem = NSMenuItem(title: single || !shortcutOK ? "Lock Now" : "Lock Now   \(shortcut.display)", action: #selector(lockNow),
                                  keyEquivalent: single && shortcutOK ? shortcut.key.lowercased() : "")
        lockItem.keyEquivalentModifierMask = shortcut.eventModifiers
        lockItem.target = self
        menu.addItem(lockItem)
        let change = NSMenuItem(title: shortcutOK ? "Change Shortcut…" : "Shortcut \(shortcut.display) Unavailable — Change…",
                                action: #selector(changeShortcut), keyEquivalent: "")
        change.target = self
        menu.addItem(change)
        menu.addItem(.separator())

        let idleMenu = NSMenu()
        let current = defaults.integer(forKey: "idleMinutes")
        for m in Self.idleChoices {
            let item = NSMenuItem(title: m == 0 ? "Never" : "After \(m) min", action: #selector(setIdle(_:)), keyEquivalent: "")
            item.tag = m
            item.target = self
            item.state = m == current ? .on : .off
            idleMenu.addItem(item)
        }
        let idleItem = NSMenuItem(title: "Lock When Idle", action: nil, keyEquivalent: "")
        idleItem.submenu = idleMenu
        menu.addItem(idleItem)

        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)

        let block = NSMenuItem(title: "Block System Shortcuts While Locked", action: #selector(toggleBlocker), keyEquivalent: "")
        block.target = self
        block.state = InputBlocker.isTrusted ? .on : .off
        block.toolTip = "Uses Accessibility permission to stop Spotlight, launcher hotkeys, function keys and gestures while locked."
        menu.addItem(block)
        menu.addItem(.separator())

        let serverItem = NSMenuItem(title: "Scene Server: \(server.status)", action: nil, keyEquivalent: "")
        serverItem.isEnabled = false
        menu.addItem(serverItem)
        menu.addItem(withTitle: "Install Claude Code Hooks", action: #selector(installHooksFromMenu), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Set Up…", action: #selector(runSetup), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Agent Office", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    @objc private func lockNow() { lock.lock() }

    /// The current hotkey is released while recording, so pressing it again doesn't lock.
    @objc private func changeShortcut() {
        hotkey?.unregister()
        let recorder = ShortcutRecorder(shortcut)
        let alert = NSAlert()
        alert.messageText = "Lock shortcut"
        alert.informativeText = "Press the keys you want to use to lock the screen."
        alert.icon = NSApp.applicationIconImage
        alert.accessoryView = recorder
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Use \(Shortcut.standard.display)")
        NSApp.activate(ignoringOtherApps: true)
        recorder.start()
        let reply = alert.runModal()
        recorder.stop()
        let chosen: Shortcut? = switch reply {
        case .alertFirstButtonReturn: recorder.shortcut
        case .alertThirdButtonReturn: .standard
        default: nil
        }
        guard let chosen, let hotkey else {
            shortcutOK = hotkey?.register(shortcut) ?? false
            return
        }
        if hotkey.register(chosen) {
            shortcut = chosen
            shortcut.save(defaults)
            shortcutOK = true
        } else {
            shortcutOK = hotkey.register(shortcut)
            let fail = NSAlert()
            fail.messageText = "\(chosen.display) is already taken"
            fail.informativeText = "macOS or another app uses this shortcut. Pick another one."
            fail.runModal()
        }
    }

    @objc private func setIdle(_ sender: NSMenuItem) { defaults.set(sender.tag, forKey: "idleMinutes") }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            NSAlert(error: error).runModal()
        }
    }

    /// The permission can only be granted (or revoked) by the user, in System Settings.
    @objc private func toggleBlocker() {
        if InputBlocker.isTrusted {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        } else {
            InputBlocker.requestTrust()
        }
    }
}
