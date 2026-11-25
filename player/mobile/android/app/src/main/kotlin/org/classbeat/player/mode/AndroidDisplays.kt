package org.classbeat.player.mode

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.Display

/** The system's displays, as [ExternalDisplay] needs them: the presentation displays, and a callback when any changes. */
class AndroidDisplays(context: Context) : DisplaySource {
    private val manager = context.getSystemService(DisplayManager::class.java)
    private var listener: DisplayManager.DisplayListener? = null

    override fun presentationDisplays(): List<Int> =
        manager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .map { it.displayId }
            .filter { it != Display.DEFAULT_DISPLAY }

    override fun listen(changed: () -> Unit) {
        stopListening()
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = changed()

            override fun onDisplayRemoved(displayId: Int) = changed()

            override fun onDisplayChanged(displayId: Int) = changed()
        }
        listener = l
        manager.registerDisplayListener(l, Handler(Looper.getMainLooper()))
    }

    override fun stopListening() {
        listener?.let(manager::unregisterDisplayListener)
        listener = null
    }
}
