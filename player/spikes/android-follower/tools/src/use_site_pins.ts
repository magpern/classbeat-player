// The exact statements (whitespace collapsed) that name Intent, ComponentName or getSystemService, per file.
// Pure data for use_sites.ts. Any other statement naming one of them fails the guard, so a new use site
// means a change here in the same pull request, which gets reviewed.

export const USE_SITE_PINS: Record<string, string[]> = {
  "app/src/main/kotlin/org/classbeat/spike/follower/MainActivity.kt": [
    "import android.content.ComponentName",
    "import android.content.Intent",
    "column.addView(button(\"Open notification access settings\") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) })",
    "column.addView(button(\"Run scene frame rate ($RUN_SECONDS s, Low)\") { stopFollowing() startActivity(Intent(this, SceneActivity::class.java)) })",
    "val granted = getSystemService(NotificationManager::class.java) .isNotificationListenerAccessGranted(ComponentName(this, SpikeListener::class.java))",
    "val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {",
    "putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)",
    "addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }",
    "startActivity(Intent.createChooser(send, \"Share the spike logs\")) }",
  ],
  "app/src/main/kotlin/org/classbeat/spike/follower/SpotifyReader.kt": [
    "import android.content.ComponentName",
    "private val manager = context.getSystemService(MediaSessionManager::class.java)",
    "private val listener = ComponentName(context, SpikeListener::class.java)",
  ],
};
