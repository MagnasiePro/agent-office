import Foundation

/// Runs the scene server bundled in `Contents/Resources/server` when nothing answers on the scene URL
/// (a dev server or the LaunchAgent wins if already running), restarts it if it dies, stops it on quit.
@MainActor
final class SceneServer {
    private(set) var status = "Starting…"
    private var process: Process?
    private var checking = false
    private var lastStart = Date.distantPast
    private let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/AgentOffice-server.log")

    private var url: URL {
        URL(string: UserDefaults.standard.string(forKey: "sceneURL") ?? "") ?? URL(string: "http://localhost:4317/")!
    }

    private var isLocal: Bool { ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "") }

    /// Called every few seconds: cheap when the server is up.
    func ensureRunning() {
        guard isLocal else { status = "Remote scene (\(url.host ?? "?"))"; return }
        if let p = process, p.isRunning { return }
        guard !checking else { return }
        checking = true
        var req = URLRequest(url: url.appendingPathComponent("health"))
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, response, _ in
            let up = (response as? HTTPURLResponse)?.statusCode == 200
            Task { @MainActor in
                self.checking = false
                if up { self.status = "Running (started outside the app)" } else { self.start() }
            }
        }.resume()
    }

    func stop() {
        process?.terminate()
        process = nil
    }

    private func start() {
        // Throttle restarts (e.g. port taken by something else).
        guard Date().timeIntervalSince(lastStart) > 20 else { return }
        lastStart = Date()
        guard let script = Bundle.main.url(forResource: "index", withExtension: "mjs", subdirectory: "server/server") else {
            status = "Not bundled in this build"
            return
        }
        guard let node = Self.findNode() else {
            status = "Not running: Node.js not found"
            return
        }
        let p = Process()
        p.executableURL = node
        p.arguments = [script.path]
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        env["PORT"] = String(url.port ?? 80)
        env["DEMO"] = env["DEMO"] ?? "1"
        p.environment = env
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        if let out = try? FileHandle(forWritingTo: log) {
            out.seekToEndOfFile()
            p.standardOutput = out
            p.standardError = out
        }
        p.terminationHandler = { proc in
            Task { @MainActor in if self.process === proc { self.status = "Stopped (exit \(proc.terminationStatus)), restarting…" } }
        }
        do {
            try p.run()
            process = p
            status = "Running (bundled, port \(url.port ?? 80))"
        } catch {
            status = "Failed to start: \(error.localizedDescription)"
        }
    }

    /// Runs a bundled Node script (e.g. the Claude Code hooks installer) and returns its output.
    func runScript(_ name: String, _ args: [String]) -> (ok: Bool, output: String) {
        guard let script = Bundle.main.url(forResource: name, withExtension: "mjs") else { return (false, "\(name).mjs is not bundled in this build.") }
        guard let node = Self.findNode() else { return (false, "Node.js not found.") }
        let p = Process()
        p.executableURL = node
        p.arguments = [script.path] + args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (false, error.localizedDescription) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus == 0, String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var port: Int { url.port ?? 80 }

    /// Node bundled in the app (`build.sh package`), then the one found at build time, then the usual install locations.
    static func findNode() -> URL? {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser.path
        var candidates: [String] = []
        if let bundled = Bundle.main.url(forAuxiliaryExecutable: "node") { candidates.append(bundled.path) }
        if let s = UserDefaults.standard.string(forKey: "nodePath") { candidates.append(s) }
        if let s = Bundle.main.object(forInfoDictionaryKey: "AgentOfficeNode") as? String { candidates.append(s) }
        candidates += [
            "/opt/homebrew/bin/node", "/usr/local/bin/node",
            "\(home)/.local/share/fnm/aliases/default/bin/node",
            "\(home)/Library/Application Support/fnm/aliases/default/bin/node",
            "\(home)/.volta/bin/node", "\(home)/.local/share/mise/shims/node", "\(home)/.asdf/shims/node",
        ]
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? fm.contentsOfDirectory(atPath: nvm) {
            for v in versions.sorted(using: .localizedStandard).reversed() { candidates.append("\(nvm)/\(v)/bin/node") }
        }
        if let path = candidates.first(where: fm.isExecutableFile(atPath:)) { return URL(fileURLWithPath: path) }

        // Last resort: ask a login shell.
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        let path = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return fm.isExecutableFile(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}
