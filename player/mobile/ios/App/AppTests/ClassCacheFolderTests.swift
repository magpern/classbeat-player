import XCTest
@testable import App

// The class cache's folder (issue #896): in Application Support, excluded from backup, read back
// from the system, and still excluded after the cache is cleared.
final class ClassCacheFolderTests: XCTestCase {
    private var base: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        base = try ClassCacheFolder.applicationSupport().appendingPathComponent("test-" + UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        if let base = base, FileManager.default.fileExists(atPath: base.path) { try FileManager.default.removeItem(at: base) }
        try super.tearDownWithError()
    }

    func testTheFolderIsInApplicationSupport() throws {
        let support = try ClassCacheFolder.applicationSupport()
        XCTAssertTrue(support.path.contains("/Library/Application Support"), support.path)
        XCTAssertEqual(ClassCacheFolder(base: support).url.lastPathComponent, ClassCacheFolder.name)
        XCTAssertEqual(ClassCacheFolder(base: support).url.deletingLastPathComponent().standardizedFileURL, support.standardizedFileURL)
    }

    func testPrepareExcludesTheFolderFromBackup() throws {
        let folder = ClassCacheFolder(base: base)
        XCTAssertFalse(folder.excludedFromBackup())
        try folder.prepare()
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.url.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
        XCTAssertTrue(folder.excludedFromBackup())
        let values = try folder.url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
    }

    func testClearDeletesEveryClassAndTheFolderStaysExcluded() throws {
        let folder = ClassCacheFolder(base: base)
        try folder.prepare()
        let file = folder.url.appendingPathComponent("class.json")
        try Data("{}".utf8).write(to: file)
        try folder.clear()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.url.path))
        XCTAssertTrue(folder.excludedFromBackup())
    }

    func testForgettingTheCacheThroughThePortsClearsIt() throws {
        let folder = ClassCacheFolder(base: base)
        try folder.prepare()
        let file = folder.url.appendingPathComponent("class.json")
        try Data("{}".utf8).write(to: file)
        PhonePairingPorts(cache: folder).forgetCache()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(folder.excludedFromBackup())
    }
}
