import Foundation
import Network
import Combine

/// Centralized download manager for media attachments.
/// Manages a concurrent download queue with progress tracking,
/// network-aware auto-download, and cancellation support.
@MainActor
final class DownloadManager: ObservableObject {
    static let shared = DownloadManager()

    // MARK: – Types

    enum DownloadState: Equatable {
        case idle
        case autoQueued
        case downloading(progress: Double)
        case decrypting
        case ready(localURL: URL)
        case error(message: String)
        case expired
        case cancelled
    }

    struct DownloadTask: Identifiable {
        let id: String  // uploadId
        let uploadId: String
        let keyMaterialBase64: String
        let fileName: String
        let contentType: String
        let byteSize: Int
        var state: DownloadState = .idle
    }

    // MARK: – State

    /// Observable per-upload states for UI binding.
    @Published private(set) var taskStates: [String: DownloadState] = [:]

    private var tasks: [String: DownloadTask] = [:]
    private var activeCount = 0
    private let maxConcurrent = 3
    private var pendingQueue: [String] = []

    // MARK: – Public API

    func state(for uploadId: String) -> DownloadState {
        taskStates[uploadId] ?? .idle
    }

    /// Enqueues a download. If already downloaded or in progress, returns immediately.
    func enqueue(
        uploadId: String,
        keyMaterialBase64: String,
        fileName: String,
        contentType: String,
        byteSize: Int,
        token: String,
        transferService: MediaTransferService
    ) {
        if let existing = tasks[uploadId] {
            switch existing.state {
            case .downloading, .decrypting, .ready, .autoQueued:
                return
            default:
                break
            }
        }

        let task = DownloadTask(
            id: uploadId,
            uploadId: uploadId,
            keyMaterialBase64: keyMaterialBase64,
            fileName: fileName,
            contentType: contentType,
            byteSize: byteSize,
            state: .autoQueued
        )
        tasks[uploadId] = task
        updateState(uploadId, .autoQueued)
        pendingQueue.append(uploadId)
        processQueue(token: token, transferService: transferService)
    }

    /// Cancels a pending or in-progress download.
    func cancel(uploadId: String) {
        pendingQueue.removeAll(where: { $0 == uploadId })
        if tasks[uploadId] != nil {
            updateState(uploadId, .cancelled)
            tasks[uploadId]?.state = .cancelled
        }
    }

    /// Retries a failed download.
    func retry(uploadId: String, token: String, transferService: MediaTransferService) {
        guard let task = tasks[uploadId], case .error = task.state else { return }
        tasks[uploadId]?.state = .autoQueued
        updateState(uploadId, .autoQueued)
        pendingQueue.append(uploadId)
        processQueue(token: token, transferService: transferService)
    }

    // MARK: – Queue processing

    private func processQueue(token: String, transferService: MediaTransferService) {
        while activeCount < maxConcurrent, let nextId = pendingQueue.first {
            pendingQueue.removeFirst()
            guard tasks[nextId] != nil else { continue }
            activeCount += 1
            // Spawn the actual download task
            Task { [weak self] in
                await self?.executeDownload(uploadId: nextId, token: token, transferService: transferService)
            }
        }
    }

    private func executeDownload(uploadId: String, token: String, transferService: MediaTransferService) async {
        guard tasks[uploadId] != nil else {
            activeCount -= 1
            return
        }

        updateState(uploadId, .downloading(progress: 0))
        tasks[uploadId]?.state = .downloading(progress: 0)

        do {
            updateState(uploadId, .downloading(progress: 0.3))
            tasks[uploadId]?.state = .downloading(progress: 0.3)

            updateState(uploadId, .decrypting)
            tasks[uploadId]?.state = .decrypting

            let decryptedData = try await transferService.fetchAndDecrypt(
                token: token,
                uploadID: uploadId,
                keyMaterialBase64: tasks[uploadId]?.keyMaterialBase64
            )

            let localURL = try saveToCache(data: decryptedData, fileName: tasks[uploadId]?.fileName ?? uploadId)

            let readyState = DownloadState.ready(localURL: localURL)
            tasks[uploadId]?.state = readyState
            updateState(uploadId, readyState)
        } catch {
            let errorState = DownloadState.error(message: error.localizedDescription)
            tasks[uploadId]?.state = errorState
            updateState(uploadId, errorState)
        }

        activeCount -= 1
    }

    private func updateState(_ uploadId: String, _ state: DownloadState) {
        taskStates[uploadId] = state
    }

    private func saveToCache(data: Data, fileName: String) throws -> URL {
        guard let baseDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw DownloadError.noCacheDirectory
        }
        let cacheDir = baseDir.appendingPathComponent("VostokMedia", isDirectory: true)
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let fileURL = cacheDir.appendingPathComponent(fileName)
        try data.write(to: fileURL)
        return fileURL
    }

    enum DownloadError: LocalizedError {
        case noCacheDirectory
        var errorDescription: String? { "No cache directory available" }
    }
}

// MARK: – Auto-Download Settings

struct AutoDownloadChatConfig: Codable, Equatable {
    var photos: AutoDownloadMediaConfig
    var videos: AutoDownloadMediaConfig
    var files: AutoDownloadMediaConfig
    var voiceMessages: AutoDownloadMediaConfig
    var roundVideos: AutoDownloadMediaConfig

    enum CodingKeys: String, CodingKey {
        case photos, videos, files
        case voiceMessages = "voice_messages"
        case roundVideos = "round_videos"
    }

    static let `default` = AutoDownloadChatConfig(
        photos: .init(maxSizeBytes: 5_242_880, onCellular: true),
        videos: .init(maxSizeBytes: 0, onCellular: false),
        files: .init(maxSizeBytes: 0, onCellular: false),
        voiceMessages: .init(maxSizeBytes: 5_242_880, onCellular: true),
        roundVideos: .init(maxSizeBytes: 0, onCellular: false)
    )
}

struct AutoDownloadMediaConfig: Codable, Equatable {
    var maxSizeBytes: Int
    var onCellular: Bool

    enum CodingKeys: String, CodingKey {
        case maxSizeBytes = "max_size_bytes"
        case onCellular = "on_cellular"
    }

    var isEnabled: Bool { maxSizeBytes > 0 }

    var displayLimit: String {
        if maxSizeBytes <= 0 { return L10n.t("off") }
        if maxSizeBytes >= 100_000_000 { return L10n.t("no_limit") }
        let mb = maxSizeBytes / 1_048_576
        return L10n.t("up_to", "\(mb) MB")
    }
}

struct AutoDownloadSettings: Codable, Equatable {
    var privateChats: AutoDownloadChatConfig
    var groupChats: AutoDownloadChatConfig

    enum CodingKeys: String, CodingKey {
        case privateChats = "private_chats"
        case groupChats = "group_chats"
    }

    static let `default` = AutoDownloadSettings(
        privateChats: .default,
        groupChats: .default
    )
}

// MARK: – Network Monitor for download decisions

final class DownloadNetworkMonitor {
    static let shared = DownloadNetworkMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "chat.vostok.ios.download-network")

    private(set) var isWiFi = true
    private(set) var isCellular = false
    private(set) var isConnected = true

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.isConnected = path.status == .satisfied
            self?.isWiFi = path.usesInterfaceType(.wifi)
            self?.isCellular = path.usesInterfaceType(.cellular)
        }
        monitor.start(queue: queue)
    }

    func shouldAutoDownload(config: AutoDownloadMediaConfig, byteSize: Int) -> Bool {
        guard isConnected else { return false }
        guard config.maxSizeBytes > 0 else { return false }
        guard byteSize <= config.maxSizeBytes else { return false }
        if isCellular && !config.onCellular { return false }
        return true
    }
}
