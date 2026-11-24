package org.classbeat.player

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import java.io.ByteArrayInputStream
import org.classbeat.player.policy.NavigationPolicy

/**
 * Capacitor's web view client, narrowed (issue #627): it serves the bundle's own files and
 * nothing else, and replaces Capacitor's launchIntent, which lets data: and blob: pages load and
 * hands any other URL of any scheme to the system. Decisions are NavigationPolicy's.
 */
class LockedWebViewClient(bridge: Bridge, private val context: Context) : BridgeWebViewClient(bridge) {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
        if (!NavigationPolicy.serves(request.url.toString())) return refused()
        return super.shouldInterceptRequest(view, request) ?: notFound()
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        return when (NavigationPolicy.navigate(url, request.isForMainFrame, request.hasGesture())) {
            NavigationPolicy.Decision.LOAD -> false
            NavigationPolicy.Decision.BROWSER -> {
                openInBrowser(url)
                true
            }
            NavigationPolicy.Decision.REFUSE -> true
        }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
    }

    private fun openInBrowser(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No browser: the link does nothing.
        }
    }

    companion object {
        private fun empty(status: Int, reason: String): WebResourceResponse =
            WebResourceResponse("text/plain", "utf-8", status, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

        /** Anything outside the bundle, and every Capacitor special path. */
        fun refused(): WebResourceResponse = empty(403, "Forbidden")

        /** A bundle path with no file: answered here, never passed on to the network. */
        fun notFound(): WebResourceResponse = empty(404, "Not Found")
    }
}
