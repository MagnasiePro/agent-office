import AppKit
import Carbon

/// A key plus Carbon modifiers, saved in user defaults; `key` is the label shown for it (layout-dependent, captured when recorded).
struct Shortcut: Equatable {
    var keyCode: Int
    var modifiers: Int
    var key: String

    static let standard = Shortcut(keyCode: kVK_ANSI_L, modifiers: controlKey | optionKey | cmdKey, key: "L")

    var display: String {
        [(controlKey, "⌃"), (optionKey, "⌥"), (shiftKey, "⇧"), (cmdKey, "⌘")]
            .filter { modifiers & $0.0 != 0 }.map(\.1).joined() + key
    }

    var eventModifiers: NSEvent.ModifierFlags {
        var flags: NSEvent.ModifierFlags = []
        if modifiers & controlKey != 0 { flags.insert(.control) }
        if modifiers & optionKey != 0 { flags.insert(.option) }
        if modifiers & shiftKey != 0 { flags.insert(.shift) }
        if modifiers & cmdKey != 0 { flags.insert(.command) }
        return flags
    }

    /// nil unless ⌃, ⌥ or ⌘ is held: a bare key (or ⇧+key) would fire while typing.
    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.isDisjoint(with: [.control, .option, .command]) else { return nil }
        var mods = 0
        if flags.contains(.control) { mods |= controlKey }
        if flags.contains(.option) { mods |= optionKey }
        if flags.contains(.shift) { mods |= shiftKey }
        if flags.contains(.command) { mods |= cmdKey }
        let code = Int(event.keyCode)
        let chars = event.charactersIgnoringModifiers?.trimmingCharacters(in: .controlCharacters.union(.whitespaces)) ?? ""
        self.init(keyCode: code, modifiers: mods, key: Self.specialKeys[code] ?? (chars.isEmpty ? "#\(code)" : chars.uppercased()))
    }

    init(keyCode: Int, modifiers: Int, key: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.key = key
    }

    private static let specialKeys: [Int: String] = [
        kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫", kVK_ForwardDelete: "⌦", kVK_Escape: "⎋",
        kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓",
        kVK_Home: "↖", kVK_End: "↘", kVK_PageUp: "⇞", kVK_PageDown: "⇟",
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
        kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
    ]

    static func load(_ defaults: UserDefaults) -> Shortcut {
        guard let key = defaults.string(forKey: "shortcutKey") else { return .standard }
        return Shortcut(keyCode: defaults.integer(forKey: "shortcutKeyCode"), modifiers: defaults.integer(forKey: "shortcutModifiers"), key: key)
    }

    func save(_ defaults: UserDefaults) {
        defaults.set(keyCode, forKey: "shortcutKeyCode")
        defaults.set(modifiers, forKey: "shortcutModifiers")
        defaults.set(key, forKey: "shortcutKey")
    }
}

/// Global hotkey through Carbon's RegisterEventHotKey: needs no Accessibility permission (unlike a CGEventTap).
@MainActor
final class Hotkey {
    nonisolated(unsafe) private static var action: (() -> Void)?
    private var ref: EventHotKeyRef?

    init(action: @escaping () -> Void) {
        Hotkey.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { Hotkey.action?() }
            return noErr
        }, 1, &spec, nil, nil)
    }

    /// False when macOS refuses the combination (taken by the system or another app).
    @discardableResult
    func register(_ shortcut: Shortcut) -> Bool {
        unregister()
        return RegisterEventHotKey(UInt32(shortcut.keyCode), UInt32(shortcut.modifiers), EventHotKeyID(signature: 0x414F_4C4B, id: 1),
                                   GetApplicationEventTarget(), 0, &ref) == noErr
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
    }
}

/// Click-free recorder for the shortcut alert: shows the combination pressed while the alert is up.
@MainActor
final class ShortcutRecorder: NSView {
    private(set) var shortcut: Shortcut
    private let label = NSTextField(labelWithString: "")
    private let hint = NSTextField(labelWithString: "Press the new shortcut (with ⌃, ⌥ or ⌘)")
    private var monitor: Any?

    init(_ shortcut: Shortcut) {
        self.shortcut = shortcut
        super.init(frame: NSRect(x: 0, y: 0, width: 300, height: 64))
        let box = NSBox(frame: NSRect(x: 0, y: 22, width: 300, height: 40))
        box.boxType = .custom
        box.cornerRadius = 8
        box.borderColor = .separatorColor
        box.fillColor = .controlBackgroundColor
        label.font = .monospacedSystemFont(ofSize: 18, weight: .medium)
        label.alignment = .center
        label.frame = NSRect(x: 0, y: 8, width: 300, height: 24)
        box.addSubview(label)
        hint.font = .systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        hint.frame = NSRect(x: 0, y: 0, width: 300, height: 16)
        addSubview(box)
        addSubview(hint)
        update()
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Combinations are swallowed; plain Return / Esc still reach the alert's buttons.
    func start() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let s = Shortcut(event: event) else { return event }
            MainActor.assumeIsolated { self?.set(s) }
            return nil
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    func set(_ s: Shortcut) {
        shortcut = s
        update()
    }

    private func update() { label.stringValue = shortcut.display }
}
