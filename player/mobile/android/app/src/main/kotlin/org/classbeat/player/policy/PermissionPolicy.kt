package org.classbeat.player.policy

// The permissions the app may ask for (issue #627). Pure: no Android import.
//
// The locked shell asks for none. The one entry is the signature permission androidx.core adds
// to every app that uses it (it guards the app's own non-exported receivers). The never list is
// checked on its own as well, so an allowlist edit cannot let one of them in.

object PermissionPolicy {
    /** The permissions the merged manifest may hold, for an app with the given package name. */
    fun allowed(packageName: String): Set<String> = setOf("$packageName.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")

    /** Never, whatever the allowlist says: the camera, the microphone, any location. */
    val NEVER: Set<String> = setOf(
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.ACCESS_MEDIA_LOCATION",
    )

    /** The permissions in [asked] the app must not have; empty when the manifest is allowed. */
    fun violations(asked: Collection<String>, packageName: String): List<String> {
        val allowed = allowed(packageName) - NEVER
        return asked.filter { it in NEVER || it !in allowed || it.contains("LOCATION") }.distinct().sorted()
    }
}
