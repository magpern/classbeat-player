package org.classbeat.player

import android.net.Uri
import android.os.Message
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView

/**
 * Replaces Capacitor's chrome client, which asks for the camera and microphone when a page wants
 * them and grants every other resource outright, and offers a file chooser (issue #627). Here the
 * page is given nothing: no permission, no location, no file, no new window.
 */
class LockedChromeClient : WebChromeClient() {
    override fun onPermissionRequest(request: PermissionRequest) {
        request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, false, false)
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean {
        filePathCallback.onReceiveValue(null)
        return true
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean = false
}
