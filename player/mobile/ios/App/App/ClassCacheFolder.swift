import Foundation

// Where cached classes go (issue #896, ADR 0016 section 4): a folder in Application Support, which
// the system never clears on its own, excluded from backup, so a class fetched with this phone's
// pairing never reaches iCloud or a computer's backup, nor a phone restored from one.
final class ClassCacheFolder {
    static let name = "classes"

    let url: URL
    private let files: FileManager

    init(base: URL, files: FileManager = .default) {
        url = base.appendingPathComponent(Self.name, isDirectory: true)
        self.files = files
    }

    /// The app's Application Support folder.
    static func applicationSupport(_ files: FileManager = .default) throws -> URL {
        try files.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    }

    /// Makes the folder and marks it excluded from backup, then reads the mark back: throws when
    /// the system did not keep it, so nothing is ever cached in a folder that is backed up.
    func prepare() throws {
        try files.createDirectory(at: url, withIntermediateDirectories: true)
        var marked = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try marked.setResourceValues(values)
        var check = url
        check.removeAllCachedResourceValues()
        guard try check.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw CocoaError(.fileWriteUnknown)
        }
    }

    /// Deletes every cached class, and leaves an empty folder, still excluded from backup.
    func clear() throws {
        if files.fileExists(atPath: url.path) { try files.removeItem(at: url) }
        try prepare()
    }

    /// Whether the folder is now excluded from backup, read fresh from the system.
    func excludedFromBackup() -> Bool {
        var check = url
        check.removeAllCachedResourceValues()
        return (try? check.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup) == true
    }
}
