package org.classbeat.spike.follower

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Empty on purpose (ADR 0011 section 6). Android lets an app list other apps' media sessions only
 * when it has an enabled notification listener, so this class exists to be enabled. Its callbacks
 * do nothing and it never reads a notification.
 */
class SpikeListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {}

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}
}
