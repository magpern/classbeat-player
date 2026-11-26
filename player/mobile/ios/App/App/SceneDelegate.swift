import UIKit

// The one window (Info.plist's UIApplicationSceneManifest names this class): the locked shell.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = ShellViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
