package org.classbeat.player.follow

import android.app.Activity
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings

/**
 * [ListenerAccess] on Android: the grant is the system's own answer each time it is asked, never a
 * cached value; the switch is the listener component's enabled state (DONT_KILL_APP, so the page
 * keeps running); the setting is Android's notification-access screen, opened on this app's
 * listener where the phone can (Android 11 and later).
 */
class AndroidListenerAccess(private val activity: Activity) : ListenerAccess {
    private val listener = ComponentName(activity, FollowListener::class.java)

    override fun granted(): Boolean =
        activity.getSystemService(NotificationManager::class.java)?.isNotificationListenerAccessGranted(listener) == true

    override fun enable(on: Boolean) {
        val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        activity.packageManager.setComponentEnabledSetting(listener, state, PackageManager.DONT_KILL_APP)
    }

    override fun openSetting(): Boolean {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listener.flattenToString())
        } else {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
        return try {
            activity.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        }
    }
}
