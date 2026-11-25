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
 * The room screen on an external display (issue #738): the bundled room page, full screen, in a web
 * view locked down like the main one. It is a plain web view, not Capacitor's: no bridge is built
 * for it and no script interface is added, so the page has no native method to call. It has the
 * same settings (BridgeLockdown.harden: no network, no file or content access) and the same chrome
 * client (no permission), and the bundle is served by an asset loader that answers only what
 * [ExternalDisplayPolicy.mayLoad] allows. The page runs on the fake room (fake-room.ts) as on the phone.
 */
class RoomPresentation(private val activity: Activity, display: Display) : Presentation(activity, display) {
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
        view.webViewClient = PresentationClient(activity)
        view.webChromeClient = LockedChromeClient()
        setContentView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = view
        view.loadUrl(NavigationPolicy.APP_ORIGIN + ExternalDisplayPolicy.ROOM_PAGE)
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
private class PresentationClient(context: Context) : WebViewClient() {
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

    // A dead renderer must not take the app down; the next presentation builds a new web view.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean = true
}

/** Shows [RoomPresentation] on a display by id. [ExternalDisplay] decides when. */
class AndroidRoomSurface(private val activity: Activity) : RoomSurface {
    private var current: RoomPresentation? = null

    override fun show(id: Int, gone: () -> Unit) {
        val display = activity.getSystemService(DisplayManager::class.java).getDisplay(id)
        if (display == null) return gone()
        val presentation = RoomPresentation(activity, display)
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

    override fun dismiss() {
        val presentation = current ?: return
        current = null
        presentation.setOnDismissListener(null)
        presentation.dismiss()
        presentation.release()
    }
}
