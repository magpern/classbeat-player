import UIKit
import WebKit
import Capacitor

// The shell (issue #894, ADR 0016 section 2): Capacitor's bridge view controller with every
// setting it reads taken from WebViewFactory, the one place that makes and locks the web view.
// It also starts the mode holder (issue #895): the two mode plugins go on the bridge before it is
// locked, and the app opens in rider mode once the view has loaded.
final class ShellViewController: CAPBridgeViewController {
    private var controller: ModeController?
    private var screens: AlertScreens?
    private var loader: WebPageLoader?

    override func instanceDescriptor() -> InstanceDescriptor {
        WebViewFactory.descriptor()
    }

    override func router() -> Router {
        CapacitorRouter()
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        WebViewFactory.configuration()
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        WebViewFactory.make(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        // Fail closed: a shell that cannot be locked does not run.
        guard let webView = webView, let bridge = bridge as? CapacitorBridge else {
            fatalError("classbeat: the web view or the bridge is missing")
        }
        let screens = AlertScreens(host: self)
        let loader = WebPageLoader(webView)
        let controller = ModeController(lock: DeviceLock(), screens: screens, loader: loader) { failed in
            fatalError("classbeat: the mode switch could not drop \(failed)")
        }
        let rider = RiderModePlugin()
        rider.controller = controller
        let instructor = InstructorModePlugin()
        instructor.controller = controller
        bridge.registerPluginInstance(rider)
        bridge.registerPluginInstance(instructor)
        self.screens = screens
        self.loader = loader
        self.controller = controller
        WebViewFactory.lock(webView, bridge: bridge, gate: controller) { [weak controller] in controller?.exposed }
    }

    override func viewDidLoad() {
        // Capacitor asks for its start URL here; the gate refuses it, as no mode is open yet.
        super.viewDidLoad()
        guard let controller = controller else {
            fatalError("classbeat: the mode holder is missing")
        }
        do {
            try controller.start(device: PhoneDevice(lock: DeviceLock()), store: DefaultsModeStore(), parts: ModeParts.teardown())
        } catch {
            fatalError("classbeat: the mode holder could not start")
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(stopped), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(resumed), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// The mode the app is in, for the tests.
    var mode: Mode? { controller?.current }

    @objc private func stopped() {
        controller?.stopped()
    }

    @objc private func resumed() {
        controller?.resumed()
    }
}

/// Loads a bundled page in the main frame.
final class WebPageLoader: PageLoader {
    private weak var webView: WKWebView?

    init(_ webView: WKWebView) {
        self.webView = webView
    }

    func load(_ path: String) {
        guard let url = URL(string: NavigationPolicy.appOrigin + path) else { return }
        webView?.load(URLRequest(url: url))
    }
}
