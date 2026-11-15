package org.classbeat.spike.follower

import android.app.Activity
import android.app.NotificationManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.FileProvider

/** The whole UI of spike 3, built in code: follow Spotify, mark, run the scene, share the logs. */
class MainActivity : Activity() {
    private var session: FollowSession? = null
    private lateinit var access: TextView
    private lateinit var reading: TextView
    private lateinit var toggle: Button
    private val whileFollowing = ArrayList<Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 48, 32, 32) }

        column.addView(text("Spike 3: follow Spotify and measure the scene. Nothing leaves this phone."))
        access = text("")
        column.addView(access)
        column.addView(button("Open notification access settings") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })

        toggle = button("Start following") { if (session == null) startFollowing() else stopFollowing() }
        column.addView(toggle)
        reading = text("Not following.")
        column.addView(reading)
        for ((label, key) in listOf("Beat (b)" to "b", "Mark (m)" to "m")) {
            column.addView(button(label) { session?.marker(key) }.also { whileFollowing.add(it) })
        }
        for ((label, key) in listOf("Undo (u)" to "undo", "Relink (r)" to "relink")) {
            column.addView(button(label) { session?.control(key) }.also { whileFollowing.add(it) })
        }

        column.addView(button("Run scene frame rate ($RUN_SECONDS s, Low)") {
            stopFollowing()
            startActivity(Intent(this, SceneActivity::class.java))
        })
        column.addView(button("Share logs") { shareLogs() })

        setContentView(ScrollView(this).apply { addView(column) })
        updateButtons()
    }

    override fun onResume() {
        super.onResume()
        val granted = getSystemService(NotificationManager::class.java)
            .isNotificationListenerAccessGranted(ComponentName(this, SpikeListener::class.java))
        access.text = if (granted) "Notification access: granted." else "Notification access: NOT granted. Open the settings and switch it on for this app."
    }

    private fun text(s: String) = TextView(this).apply { text = s; textSize = 16f; setPadding(0, 16, 0, 16) }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        setOnClickListener { onClick() }
    }

    private fun startFollowing() {
        val s = FollowSession(this) { line -> runOnUiThread { reading.text = line } }
        session = s
        s.start()
        reading.text = "Following, log ${s.fileName}"
        updateButtons()
    }

    private fun stopFollowing() {
        session?.stop()
        session = null
        reading.text = "Not following."
        updateButtons()
    }

    private fun updateButtons() {
        toggle.text = if (session == null) "Start following" else "Stop following"
        for (b in whileFollowing) b.visibility = if (session == null) View.GONE else View.VISIBLE
    }

    /** The share sheet with every log file: the only way a log leaves the phone, by the person's hand. */
    private fun shareLogs() {
        stopFollowing()
        val files = LogFile.logDir(this).listFiles { f -> f.name.endsWith(".jsonl") }?.sortedBy { it.name }.orEmpty()
        if (files.isEmpty()) {
            reading.text = "No logs yet."
            return
        }
        val uris = ArrayList<Uri>(files.map { FileProvider.getUriForFile(this, "org.classbeat.spike.follower.logs", it) })
        val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "text/plain"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            clipData = ClipData.newRawUri("logs", uris[0]).also { c -> uris.drop(1).forEach { c.addItem(ClipData.Item(it)) } }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, "Share the spike logs"))
    }

    override fun onDestroy() {
        session?.stop()
        super.onDestroy()
    }
}
