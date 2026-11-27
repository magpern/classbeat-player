import UIKit
import WebKit
import Capacitor

// The shell (issue #894, ADR 0016 section 2): Capacitor's bridge view controller with every
// setting it reads taken from WebViewFactory, the one place that makes and locks the web view.
// It also starts the mode holder (issue #895): the two mode plugins go on the bridge before it is
// locked, and the app opens in rider mode once the view has loaded. The mode holder also keeps the
// idle timer and the external display in step (issue #897), and holds the rider's session, whose
// token is dropped when the app goes (issue #898).
final class ShellViewController: CAPBridgeViewController {
    private var controller: ModeController?
    private var screens: AlertScreens?
    private var loader: WebPageLoader?
    private var pairing: PairingService?
    /// No live transport yet (ADR 0016 section 4): every join is unreachable.
    private let riderSession = RiderSession(transport: OfflineRiderTransport { DispatchQueue.main.async(execute: $0) })

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
        let display = ExternalDisplay(source: DisplayScenes.shared, surface: SceneRoomSurface(scenes: DisplayScenes.shared))
        let (pairing, ports) = Self.makePairing()
        // The pairing screen (issue #925) is drawn natively over the page; the controller wires the
        // service's unpair to instructor mode closing.
        let pairingUi = PairingUi(service: pairing, ports: ports, screens: PairingScreenView(host: self), ticker: SecondTicker())
        let controller = ModeController(
            lock: DeviceLock(),
            screens: screens,
            loader: loader,
            pairing: pairingUi,
            awake: KeepAwake(AppIdleTimer()),
            display: display,
            rider: riderSession
        ) { failed in
            fatalError("classbeat: the mode switch could not drop \(failed)")
        }
        self.pairing = pairing
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
        guard let controller = controller, let pairing = pairing else {
            fatalError("classbeat: the mode holder is missing")
        }
        // The stored pairing is read before the mode starts, so the holder sees it.
        pairing.load()
        let device = PhoneDevice(lock: DeviceLock()) { [weak pairing] in pairing?.paired ?? false }
        do {
            try controller.start(device: device, store: DefaultsModeStore(), parts: ModeParts.teardown(rider: riderSession))
        } catch {
            fatalError("classbeat: the mode holder could not start")
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(stopped), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(resumed), name: UIApplication.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(terminating), name: UIApplication.willTerminateNotification, object: nil)
    }

    /// The mode the app is in, for the tests.
    var mode: Mode? { controller?.current }

    @objc private func stopped() {
        controller?.stopped()
    }

    @objc private func resumed() {
        controller?.resumed()
    }

    /// The app goes: the rider token goes with it.
    @objc private func terminating() {
        riderSession.drop()
    }

    /// The pairing (issue #896): the first-launch wipe runs before anything reads the Keychain, the
    /// class cache is made excluded from backup, and with no backend in the build yet (ADR 0016
    /// section 4) the origin is nil and the transport is offline, so the phone pairs nothing.
    private static func makePairing() -> (PairingService, PairingPorts) {
        // A cache that cannot be kept out of backup closes pairing, never the app (issue #926).
        let (store, cache) = ClassCacheFolder.launch(base: { try ClassCacheFolder.applicationSupport() }) {
            FirstLaunch.store(defaults: .standard, keychain: SystemKeychain())
        }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let ports = PhonePairingPorts(cache: cache)
        let service = PairingService(
            origin: nil,
            allowLoopbackHttp: BuildFlavor.isDebug,
            version: version,
            transport: OfflineTransport { DispatchQueue.main.async(execute: $0) },
            store: store,
            ports: ports
        )
        return (service, ports)
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

/// KeepAwake's ScreenFlag on a device: the app's idle timer (issue #897).
final class AppIdleTimer: ScreenFlag {
    func keepOn(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }
}
