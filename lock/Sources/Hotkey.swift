import Carbon

/// Global hotkey through Carbon's RegisterEventHotKey: needs no Accessibility permission (unlike a CGEventTap).
@MainActor
final class Hotkey {
    nonisolated(unsafe) private static var action: (() -> Void)?
    private var ref: EventHotKeyRef?

    init(keyCode: Int = kVK_ANSI_L, modifiers: Int = controlKey | optionKey | cmdKey, action: @escaping () -> Void) {
        Hotkey.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { Hotkey.action?() }
            return noErr
        }, 1, &spec, nil, nil)
        RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), EventHotKeyID(signature: 0x414F_4C4B, id: 1),
                            GetApplicationEventTarget(), 0, &ref)
    }
}
