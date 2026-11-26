package org.classbeat.player.mode

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Presentation
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.view.Display
import android.view.ViewGroup
import android.view.WindowManager
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.classbeat.player.BridgeLockdown
import org.classbeat.player.LockedChromeClient
import org.classbeat.player.LockedWebViewClient
import org.classbeat.player.policy.ExternalDisplayPolicy
import org.classbeat.player.policy.NavigationPolicy

/**
 * The room screen, or the idle stage, on an external display (issue #738): a bundled page, full screen, in a web
 * view locked down like the main one. It is a plain web view, not Capacitor's: no bridge is built
 * for it and no script interface is added, so the page has no native method to call. It has the
 * same settings (BridgeLockdown.harden: no network, no file or content access) and the same chrome
 * client (no permission), and the bundle is served by an asset loader that answers only what
 * [ExternalDisplayPolicy.mayLoad] allows. The room screen opens a class only through the bridge, which
 * this view lacks, so while a class runs on the phone it shows the idle stage (issue #871); showing
 * the open class here is a later issue.
 */
class RoomPresentation(
    private val activity: Activity,
    display: Display,
    private var page: String,
    private val crashed: () -> Unit,
) : Presentation(activity, display) {
    var web: WebView? = null
        private set

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        val view = WebView(context)
        view.setBackgroundColor(Color.BLACK)
        BridgeLockdown.harden(view.settings)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.webViewClient = PresentationClient(activity) { view.post(crashed) }
        view.webChromeClient = LockedChromeClient()
        setContentView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = view
        view.loadUrl(NavigationPolicy.APP_ORIGIN + page)
    }

    /** Shows another bundled page (the policy's choice; the client refuses any other). */
    fun load(page: String) {
        this.page = page
        web?.loadUrl(NavigationPolicy.APP_ORIGIN + page)
    }

    /** Takes the web view off its window and frees it. */
    fun release() {
        web?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        web = null
    }
}

/** The bundle's files from the app's assets, and nothing else: no navigation, no link out, no TLS error accepted. */
private class PresentationClient(context: Context, private val renderGone: () -> Unit) : WebViewClient() {
    private val assets = WebViewAssetLoader.AssetsPathHandler(context)
    private val loader = WebViewAssetLoader.Builder()
        .setDomain("localhost")
        .addPathHandler("/") { path -> assets.handle("public/$path") }
        .build()

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
        if (!ExternalDisplayPolicy.mayLoad(request.url.toString(), request.isForMainFrame)) return LockedWebViewClient.refused()
        return loader.shouldInterceptRequest(request.url) ?: LockedWebViewClient.notFound()
    }

    // The room page has no link and nothing to navigate to: every navigation after the first is refused.
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
    }

    // A dead renderer must not take the app down: the presenter takes this presentation down and, if the
    // policy still says so, builds a new one (posted, so the web view is not freed inside its own callback).
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        renderGone()
        return true
    }
}

/** Shows [RoomPresentation] on a display by id. [ExternalDisplay] decides when. */
class AndroidRoomSurface(private val activity: Activity) : RoomSurface {
    private var current: RoomPresentation? = null

    override fun show(id: Int, page: String, gone: () -> Unit, crashed: () -> Unit) {
        val display = activity.getSystemService(DisplayManager::class.java).getDisplay(id)
        if (display == null) return gone()
        lateinit var presentation: RoomPresentation
        // The crash is posted: by the time it runs this presentation may be gone and another one shown.
        presentation = RoomPresentation(activity, display, page) { if (current === presentation) crashed() }
        presentation.setOnDismissListener {
            // The system took it down (the display went away): free it and tell the presenter.
            presentation.release()
            if (current === presentation) current = null
            gone()
        }
        current = presentation
        try {
            presentation.show()
        } catch (_: WindowManager.InvalidDisplayException) {
            // The display went away between the listing and now: the next display event decides again.
            presentation.setOnDismissListener(null)
            presentation.release()
            current = null
            gone()
        }
    }

    override fun load(page: String) {
        current?.load(page)
    }

    override fun dismiss() {
        val presentation = current ?: return
        current = null
        presentation.setOnDismissListener(null)
        presentation.dismiss()
        presentation.release()
    }
}
