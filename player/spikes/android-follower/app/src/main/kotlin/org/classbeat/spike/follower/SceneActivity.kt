package org.classbeat.spike.follower

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import org.classbeat.spike.FpsSummary
import org.classbeat.spike.FrameCounter
import org.classbeat.spike.Stamp
import org.classbeat.spike.fpsLine
import org.classbeat.spike.fpsSummaryLine
import org.classbeat.spike.metaLine
import org.classbeat.spike.summarize

/** The fixed run: this many one-second samples after the first (which only primes the counter). */
const val RUN_SECONDS = 60

/** The scene demo's own run: lowest quality level, class clock running faster than real time. */
private const val SCENE_URL =
    "https://appassets.androidplatform.net/assets/scene/index.html?auto=1&q=Low&t=0&speed=2.4&to=159"

/** Counts the page's animation frames; the Kotlin side reads the count once a second. */
private const val COUNTER_JS =
    "(function(){if(window.__spikeFrames===undefined){window.__spikeFrames=0;" +
        "var t=function(){window.__spikeFrames++;requestAnimationFrame(t)};requestAnimationFrame(t)}})()"

private const val READ_FRAMES_JS = "window.__spikeFrames"

/** The demo's own once-a-second log (scene/render/tools/frame-log.ts): the last row's fps, or null. */
private const val READ_SCENE_FPS_JS =
    "(window.__scene&&window.__scene.log.rows.length?window.__scene.log.rows[window.__scene.log.rows.length-1].fps:null)"

/**
 * Opens the scene demo from the files bundled in the APK, in the system web view, and logs frames
 * per second once a second for [RUN_SECONDS]. No network: the page is served from the APK through
 * the asset loader, network loads are blocked and the app has no INTERNET permission.
 */
class SceneActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var log: LogFile
    private val handler = Handler(Looper.getMainLooper())
    private val counter = FrameCounter()
    private val samples = ArrayList<Double>()
    private var second = 0
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        log = LogFile(this, "scene-fps")
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun onPageFinished(view: WebView, url: String) {
                if (!finished) view.evaluateJavascript(COUNTER_JS, null)
            }
        }

        status = TextView(this).apply { setTextColor(0xFFFFFFFF.toInt()); setBackgroundColor(0x99000000.toInt()); setPadding(24, 12, 24, 12) }
        val done = Button(this).apply { text = "Back"; setOnClickListener { finish() } }
        val root = FrameLayout(this)
        root.addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        root.addView(done, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END))
        setContentView(root)

        log.write(metaLine(stamp(), deviceInfo()))
        status.text = "Loading the scene, then $RUN_SECONDS s run (quality Low)"
        web.loadUrl(SCENE_URL)
        handler.postDelayed(::tick, 1000)
    }

    private fun stamp() = Stamp(SystemClock.elapsedRealtime(), System.currentTimeMillis())

    @Suppress("DEPRECATION")
    private fun deviceInfo(): Map<String, Any?> {
        val pkg = WebView.getCurrentWebViewPackage()
        return linkedMapOf(
            "event" to "start", "kind" to "scene_fps", "quality" to "Low", "runSeconds" to RUN_SECONDS,
            "sceneUrl" to SCENE_URL, "model" to Build.MODEL, "manufacturer" to Build.MANUFACTURER,
            "device" to Build.DEVICE, "androidSdk" to Build.VERSION.SDK_INT,
            "webViewPackage" to pkg?.packageName, "webViewVersion" to pkg?.versionName,
            "displayRefreshHz" to windowManager.defaultDisplay.refreshRate.toDouble(),
        )
    }

    private fun tick() {
        if (finished) return
        web.evaluateJavascript(READ_FRAMES_JS) { frames ->
            val now = SystemClock.elapsedRealtime()
            val count = frames?.toDoubleOrNull()?.toLong()
            val fps = if (count == null) null else counter.sample(count, now)
            if (fps != null) {
                web.evaluateJavascript(READ_SCENE_FPS_JS) { scene -> record(count!!, fps, scene?.toDoubleOrNull()) }
            }
        }
        handler.postDelayed(::tick, 1000)
    }

    private fun record(frames: Long, fps: Double, sceneFps: Double?) {
        if (finished) return
        log.write(fpsLine(stamp(), second, frames, fps, sceneFps))
        samples.add(fps)
        second++
        status.text = "Second $second of $RUN_SECONDS: ${"%.1f".format(fps)} fps"
        if (second >= RUN_SECONDS) endRun(summarize(samples))
    }

    private fun endRun(summary: FpsSummary) {
        finished = true
        log.write(fpsSummaryLine(stamp(), summary))
        log.write(metaLine(stamp(), linkedMapOf("event" to "end")))
        log.close()
        status.text = "Done: median ${summary.medianFps?.let { "%.1f".format(it) }} fps, min ${summary.minFps?.let { "%.1f".format(it) }}, " +
            "longest run under 30 fps ${summary.longestRunUnder30} s, Low holds: ${summary.lowLevelHolds}. Log: ${log.file.name}"
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (!finished) {
            finished = true
            log.write(metaLine(stamp(), linkedMapOf("event" to "end", "aborted" to true, "samples" to samples.size)))
            log.close()
        }
        web.destroy()
        super.onDestroy()
    }
}
