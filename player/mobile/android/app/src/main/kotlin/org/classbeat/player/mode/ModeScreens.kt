package org.classbeat.player.mode

import android.animation.ValueAnimator
import android.app.Activity
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The three native screens of docs/design/app-modes.md ("A screen lock is needed", "Switch to rider
 * mode?" and the switching screen) and the pairing screens of app-pairing.md ([screen]). Native, so
 * nothing on them is the page's and the page cannot press their keys. Sizes follow the spec's text floors (A1) as a share of the window height, keys
 * are at least 64dp high and 12dp apart, and the screens fade in over 200ms, or not at all when
 * Android's "Remove animations" is on. One screen shows at a time, over the web view.
 */
class ModeScreens(private val activity: Activity) : PairingScreens {
    /** A key: its words, whether it is the main one, and what it does. */
    class Key(val label: String, val main: Boolean, val press: () -> Unit)

    private var shown: View? = null

    /** The lines showing and their views, in order: [retext] changes their words. */
    private var shownLines: List<ScreenLine> = emptyList()
    private val lineViews = mutableListOf<View>()

    val showing: Boolean get() = shown != null

    fun noLock(setLock: () -> Unit, stay: () -> Unit) = show(
        lead = listOf(
            ScreenLine.Tag("Rider mode"),
            ScreenLine.Title("A screen lock is needed"),
            ScreenLine.Text("Instructor mode opens only after this phone's screen lock: a PIN, pattern or password."),
            ScreenLine.Note("This phone has no screen lock. Your classes and the pairing stay on it, locked away until you set one."),
        ),
        keys = listOf(Key("Set a screen lock", true, setLock), Key("Stay in rider mode", false, stay)),
    )

    fun riderQuestion(stay: () -> Unit, switch: () -> Unit) = show(
        lead = listOf(
            ScreenLine.Tag("Instructor mode"),
            ScreenLine.Title("Switch to rider mode?"),
            ScreenLine.Text(
                "The class list closes and the music is no longer followed. " +
                    "Coming back to instructor mode needs your screen lock.",
            ),
        ),
        // Side by side as the spec's duo: "Stay" first, the safe answer, with the focus.
        keys = listOf(Key("Stay", true, stay), Key("Switch", false, switch)),
        side = true,
    )

    /** Instructor mode's "Unpair this phone": the native question before anything is deleted. */
    fun unpairQuestion(stay: () -> Unit, unpair: () -> Unit) = show(
        lead = listOf(
            ScreenLine.Tag("Instructor mode"),
            ScreenLine.Title("Unpair this phone?"),
            ScreenLine.Text(
                "The classes saved on this phone are removed and instructor mode closes. " +
                    "Teaching from it again needs a new pairing.",
            ),
        ),
        // As the rider question: "Stay" first, the safe answer, with the focus.
        keys = listOf(Key("Stay", true, stay), Key("Unpair", false, unpair)),
        side = true,
    )

    /** [rider] is the target: the spec's screen is the switch to rider mode; the other way mirrors it. */
    fun switching(rider: Boolean) = show(
        lead = listOf(
            ScreenLine.Tag(if (rider) "Rider mode" else "Instructor mode"),
            ScreenLine.Title(if (rider) "Switching to rider mode" else "Switching to instructor mode"),
            ScreenLine.Working(if (rider) "Closing instructor mode" else "Closing rider mode"),
        ),
        keys = emptyList(),
    )

    override fun hide() {
        shown?.let { (it.parent as? ViewGroup)?.removeView(it) }
        shown = null
        lineViews.clear()
        shownLines = emptyList()
    }

    /** A screen of lines and keys, as the pairing screens build it; [act] goes with the keys (the steps). */
    override fun screen(lead: List<ScreenLine>, act: List<ScreenLine>, keys: List<Key>) = show(lead, keys, act = act)

    /**
     * Changes the words of the screen showing, in place (the countdown), keeping its keys and focus.
     * False when the lines are not the same kinds as those showing: the caller shows the screen anew.
     */
    override fun retext(lines: List<ScreenLine>): Boolean {
        if (shown == null || lines.size != lineViews.size || lines.zip(shownLines).any { (a, b) -> a::class != b::class }) return false
        lines.forEachIndexed { i, l -> (lineViews[i] as? TextView)?.let { if (l is ScreenLine.Code) it.text = l.code else it.text = words(l) } }
        shownLines = lines
        return true
    }

    private fun show(lead: List<ScreenLine>, keys: List<Key>, side: Boolean = false, act: List<ScreenLine> = emptyList()) {
        hide()
        val landscape = activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val size = Sizes(activity, landscape)
        val page = LinearLayout(activity).apply {
            orientation = if (landscape) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            val pad = size.dp(16f)
            setPadding(pad, pad, pad, pad)
        }
        val leadColumn = column()
        lead.forEach { leadColumn.addView(line(it, size)) }
        val actColumn = column().apply { gravity = if (landscape) Gravity.CENTER_VERTICAL else Gravity.BOTTOM }
        act.forEach { actColumn.addView(line(it, size)) }
        shownLines = lead + act
        val keyBox = if (side) LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL } else actColumn
        keys.forEachIndexed { i, key ->
            val params = if (side) {
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, if (i == 0) 1f else 2f).apply {
                    if (i > 0) leftMargin = size.dp(12f)
                }
            } else {
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    if (i > 0) topMargin = size.dp(12f)
                }
            }
            keyBox.addView(key(key, size), params)
        }
        if (side) actColumn.addView(keyBox, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        page.addView(leadColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).takeIf { landscape } ?: weighted())
        page.addView(actColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).takeIf { landscape } ?: weighted())
        val root = FrameLayout(activity).apply {
            setBackgroundColor(STAGE)
            // Takes every touch, so nothing reaches the page underneath.
            isClickable = true
            isFocusable = true
            addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        activity.addContentView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        shown = root
        keyBox.getChildAt(0)?.requestFocus()
        if (ValueAnimator.areAnimatorsEnabled()) {
            root.alpha = 0f
            root.animate().alpha(1f).setDuration(FADE_MS).start()
        }
    }

    private fun weighted() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)

    private fun column() = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

    private fun line(line: ScreenLine, size: Sizes): View {
        val view = when (line) {
            is ScreenLine.Code -> panel(STAGE_RAISED, size).also { box ->
                box.addView(text("Code", size.label, LIGHT_2, false, size))
                // The number face at more than the value tier: the largest text on the screen, never wrapped.
                val code = text(line.code, size.value * CODE_SCALE, LIGHT_1, true, size).apply {
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                    letterSpacing = 0.15f
                    maxLines = 1
                }
                box.addView(code)
                lineViews += code
            }
            is ScreenLine.Plate -> panel(LIGHT_1, size).also { box ->
                box.addView(text(line.head, size.text, INK, true, size))
                box.addView(text(line.body, size.text, INK, false, size))
                lineViews += box
            }
            else -> {
                val (px, color, bold) = when (line) {
                    is ScreenLine.Tag, is ScreenLine.Note -> Triple(size.label, LIGHT_2, line is ScreenLine.Tag)
                    is ScreenLine.Title -> Triple(size.value, LIGHT_1, true)
                    else -> Triple(size.text, LIGHT_1, false)
                }
                text(words(line), px, color, bold, size).also { lineViews += it }
            }
        }
        return view
    }

    private fun words(line: ScreenLine): String = when (line) {
        is ScreenLine.Tag -> "●  ${line.words}"
        is ScreenLine.Note -> "□  ${line.words}"
        // The hollow working marker, still: it does not spin (spec, motion).
        is ScreenLine.Working -> "○  ${line.words}"
        is ScreenLine.Title -> line.words
        is ScreenLine.Text -> line.words
        is ScreenLine.Step -> "${line.number}.  ${line.words}"
        is ScreenLine.Code -> line.code
        is ScreenLine.Plate -> "${line.head}\n${line.body}"
    }

    private fun text(words: String, px: Float, color: Int, bold: Boolean, size: Sizes) = TextView(activity).apply {
        text = words
        setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 0, 0, size.dp(12f))
    }

    private fun panel(color: Int, size: Sizes) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val pad = size.dp(16f)
        setPadding(pad, pad, pad, pad - size.dp(12f))
        background = GradientDrawable().apply {
            cornerRadius = size.dp(8f).toFloat()
            setColor(color)
        }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = size.dp(12f)
        }
    }

    private fun key(key: Key, size: Sizes): Button = Button(activity).apply {
        text = key.label
        isAllCaps = false
        minHeight = size.dp(64f)
        minimumHeight = size.dp(64f)
        stateListAnimator = null
        setTextSize(TypedValue.COMPLEX_UNIT_PX, size.key)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(if (key.main) INK else LIGHT_1)
        background = GradientDrawable().apply {
            cornerRadius = size.dp(8f).toFloat()
            setColor(if (key.main) LIGHT_1 else STAGE_RAISED)
            setStroke(size.dp(2f), if (key.main) LIGHT_1 else LIGHT_3)
        }
        isFocusable = true
        setOnClickListener { key.press() }
    }

    /** The spec's floors: a share of the window height, portrait or landscape, never under the minimum. */
    private class Sizes(activity: Activity, landscape: Boolean) {
        private val metrics = activity.resources.displayMetrics
        private val height = metrics.heightPixels.toFloat()
        val value = floor(if (landscape) 0.06f else 0.034f, 21f)
        val text = floor(if (landscape) 0.045f else 0.026f, 16.5f)
        val key = floor(if (landscape) 0.034f else 0.019f, 12.5f)
        val label = floor(if (landscape) 0.027f else 0.015f, 10f)

        fun dp(value: Float): Int = (value * metrics.density + 0.5f).toInt()

        private fun floor(share: Float, minDp: Float) = maxOf(height * share, minDp * metrics.density)
    }

    private companion object {
        const val FADE_MS = 200L

        /** The code over the value tier, so it is the largest text on the pairing screen. */
        const val CODE_SCALE = 1.25f

        // docs/design tokens: stage, stage-raised, light-1, light-2, light-3, ink.
        val STAGE = Color.parseColor("#000000")
        val STAGE_RAISED = Color.parseColor("#17171c")
        val LIGHT_1 = Color.parseColor("#f6f4ef")
        val LIGHT_2 = Color.parseColor("#bdbab2")
        val LIGHT_3 = Color.parseColor("#9a978f")
        val INK = Color.parseColor("#000000")
    }
}
