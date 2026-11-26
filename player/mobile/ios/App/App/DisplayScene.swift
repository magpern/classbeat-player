import UIKit
import WebKit

// The external display's edge (issue #897): the scenes iOS connects for a display (AirPlay or a
// cable, role windowExternalDisplayNonInteractive), and the web view ExternalDisplay shows on them.
// A connected display gets a black window of our own at once, so the phone's screen is never
// mirrored there, also before the shell has started or while no page shows. AppDelegate hands
// these scenes to DisplaySceneDelegate in code, so the Info.plist scene manifest stays as it is.

/// The external display scenes connected now, as ExternalDisplay's DisplaySource. Main thread only.
final class DisplayScenes: DisplaySource {
    static let shared = DisplayScenes()

    private var stages: [(id: Int, scene: UIScene, window: UIWindow)] = []
    private var counter = 0
    private var changed: (() -> Void)?

    func presentationDisplays() -> [Int] {
        stages.map { $0.id }
    }

    func watch(_ changed: @escaping () -> Void) {
        self.changed = changed
    }

    func stopWatching() {
        changed = nil
    }

    /// The black view that fills display `id`; nil once it has gone.
    func stage(_ id: Int) -> UIView? {
        stages.first { $0.id == id }?.window.rootViewController?.view
    }

    /// A display connected: its black window shows at once.
    func connected(_ scene: UIWindowScene) {
        let window = UIWindow(windowScene: scene)
        let root = UIViewController()
        root.view.backgroundColor = .black
        window.rootViewController = root
        window.isHidden = false
        counter += 1
        stages.append((id: counter, scene: scene, window: window))
        changed?()
    }

    func disconnected(_ scene: UIScene) {
        stages.removeAll { $0.scene === scene }
        changed?()
    }
}

/// The delegate of an external display's scene: it only reports the scene to DisplayScenes.
final class DisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {
    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene,
              session.role == .windowExternalDisplayNonInteractive else { return }
        DisplayScenes.shared.connected(windowScene)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        DisplayScenes.shared.disconnected(scene)
    }
}

/// ExternalDisplay's RoomSurface: one web view from WebViewFactory.makeDisplay on a display's stage.
final class SceneRoomSurface: RoomSurface {
    private let scenes: DisplayScenes
    private var webView: WKWebView?
    private var navigation: DisplayNavigation?

    init(scenes: DisplayScenes) {
        self.scenes = scenes
    }

    /// `gone` is not called on iOS: a display's window goes only with its scene, which DisplayScenes
    /// reports to ExternalDisplay itself.
    func show(_ id: Int, _ page: String, gone: @escaping () -> Void, crashed: @escaping () -> Void) {
        guard let stage = scenes.stage(id) else { return }
        let webView = WebViewFactory.makeDisplay(frame: stage.bounds)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.isUserInteractionEnabled = false
        let navigation = DisplayNavigation(crashed: crashed)
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation
        stage.addSubview(webView)
        self.webView = webView
        self.navigation = navigation
        load(page)
    }

    func load(_ page: String) {
        guard let url = URL(string: NavigationPolicy.appOrigin + page) else { return }
        webView?.load(URLRequest(url: url))
    }

    func dismiss() {
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        navigation = nil
    }
}
