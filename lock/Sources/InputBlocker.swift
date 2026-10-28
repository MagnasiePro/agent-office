import AppKit
import ApplicationServices

/// While locked, swallows system-wide shortcuts that kiosk mode can't stop: other apps' global hotkeys
/// (Spotlight, Raycast, Shortcuts…), function/media keys, the Globe key, scroll and trackpad gestures.
/// Plain typing (with Shift/Option) and mouse events go through, so the password field keeps working.
/// Needs Accessibility permission; without it the lock still works, just without this extra layer.
@MainActor
final class InputBlocker {
    nonisolated(unsafe) private static var tap: CFMachPort?
    private var source: CFRunLoopSource?

    static var isTrusted: Bool { AXIsProcessTrusted() }

    static func requestTrust() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    func start() {
        guard Self.tap == nil, Self.isTrusted else { return }
        // keyDown, keyUp, flagsChanged, systemDefined (media/brightness/power keys), scrollWheel and the gesture types.
        let types: [UInt64] = [10, 11, 12, 14, 18, 19, 20, 22, 29, 30, 31, 32, 34, 37]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1) }
        guard let tap = CGEvent.tapCreate(tap: .cghidEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: mask, callback: inputBlockerCallback, userInfo: nil) else { return }
        Self.tap = tap
        source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    func stop() {
        guard let tap = Self.tap else { return }
        CGEvent.tapEnable(tap: tap, enable: false)
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        CFMachPortInvalidate(tap)
        Self.tap = nil
        source = nil
    }

    nonisolated static func reenable() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    }
}

/// F1–F20, plus the dedicated keys of recent Apple keyboards (Mission Control, Spotlight, Dictation, Do Not Disturb…).
private let functionKeys: Set<Int64> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]

private func inputBlockerCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    let pass = Unmanaged.passUnretained(event)
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        InputBlocker.reenable()
        return pass
    case .keyDown, .keyUp:
        let flags = event.flags
        let key = event.getIntegerValueField(.keyboardEventKeycode)
        if flags.contains(.maskCommand) || flags.contains(.maskControl) { return nil }
        if functionKeys.contains(key) || key >= 0xA0 { return nil }
        if key == 49, flags.contains(.maskAlternate) { return nil } // ⌥Space launchers
        return pass
    case .flagsChanged:
        let key = event.getIntegerValueField(.keyboardEventKeycode)
        return key == 63 || key == 179 ? nil : pass // Globe/fn (emoji, dictation, input source)
    default:
        return nil
    }
}
