import UIKit

// The pairing's ports on the phone (issue #896, ADR 0016 section 4): a monotonic clock, the main
// queue's timer, Safari for the pairing page, and the class cache. Sign-in on the site opens in
// Safari, never in the app's web view: the page holds the site's own sign-in, which the app must
// never see.
final class PhonePairingPorts: PairingPorts {
    private let cache: ClassCacheFolder

    init(cache: ClassCacheFolder) {
        self.cache = cache
    }

    func now() -> Int {
        Int(clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1_000_000)
    }

    func at(_ time: Int, _ run: @escaping () -> Void) {
        let delayMs = max(0, time - now())
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(delayMs), execute: run)
    }

    func openPage(_ page: String) -> Bool {
        guard let url = URL(string: page), url.scheme == "https" || url.scheme == "http" else { return false }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return true
    }

    func forgetCache() {
        try? cache.clear()
    }
}
