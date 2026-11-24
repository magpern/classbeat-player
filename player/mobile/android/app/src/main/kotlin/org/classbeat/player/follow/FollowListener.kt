package org.classbeat.player.follow

import android.service.notification.NotificationListenerService

/**
 * The listener Android asks for before an app may see which music app is playing (ADR 0011 §6,
 * issue #632). It is empty on purpose: it overrides nothing, so it reads no notification, keeps
 * none and acts on none. Its only use is that the instructor can grant it access. It is disabled
 * in the manifest and enabled only while the instructor turns following on in instructor mode;
 * a switch to rider mode disables it again (Follower.drop). The guard in
 * player/mobile/test/listener-guard.test.ts checks this file stays empty.
 */
class FollowListener : NotificationListenerService()
