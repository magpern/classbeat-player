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
 * The three native screens of docs/design/app-modes.md: "A screen lock is needed", "Switch to rider
 * mode?" and the switching screen. Native, so nothing on them is the page's and the page cannot
 * press their keys. Sizes follow the spec's text floors (A1) as a share of the window height, keys
 * are at least 64dp high and 12dp apart, and the screens fade in over 200ms, or not at all when
 * Android's "Remove animations" is on. One screen shows at a time, over the web view.
 */
class ModeScreens(private val activity: Activity) {
    /** A key: its words, whether it is the main one, and what it does. */
    class Key(val label: String, val main: Boolean, val press: () -> Unit)

    private var shown: View? = null

    val showing: Boolean get() = shown != null

    fun noLock(setLock: () -> Unit, stay: () -> Unit) = show(
        lead = listOf(
            Line.Tag("Rider mode"),
            Line.Title("A screen lock is needed"),
            Line.Text("Instructor mode opens only after this phone's screen lock: a PIN, pattern or password."),
            Line.Note("This phone has no screen lock. Your classes and the pairing stay on it, locked away until you set one."),
        ),
        keys = listOf(Key("Set a screen lock", true, setLock), Key("Stay in rider mode", false, stay)),
    )

    fun riderQuestion(stay: () -> Unit, switch: () -> Unit) = show(
        lead = listOf(
            Line.Tag("Instructor mode"),
            Line.Title("Switch to rider mode?"),
            Line.Text(
                "The class list closes and the music is no longer followed. " +
                    "Coming back to instructor mode needs your screen lock.",
            ),
        ),
        // Side by side as the spec's duo: "Stay" first, the safe answer, with the focus.
        keys = listOf(Key("Stay", true, stay), Key("Switch", false, switch)),
        side = true,
    )

    /** [rider] is the target: the spec's screen is the switch to rider mode; the other way mirrors it. */
    fun switching(rider: Boolean) = show(
        lead = listOf(
            Line.Tag(if (rider) "Rider mode" else "Instructor mode"),
            Line.Title(if (rider) "Switching to rider mode" else "Switching to instructor mode"),
            Line.Working(if (rider) "Closing instructor mode" else "Closing rider mode"),
        ),
        keys = emptyList(),
    )

    fun hide() {
        shown?.let { (it.parent as? ViewGroup)?.removeView(it) }
        shown = null
    }

    private sealed class Line(val words: String) {
        class Tag(words: String) : Line(words)
        class Title(words: String) : Line(words)
        class Text(words: String) : Line(words)
        class Note(words: String) : Line(words)
        class Working(words: String) : Line(words)
    }

    private fun show(lead: List<Line>, keys: List<Key>, side: Boolean = false) {
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

    private fun line(line: Line, size: Sizes): View = TextView(activity).apply {
        text = when (line) {
            is Line.Tag -> "●  ${line.words}"
            is Line.Note -> "□  ${line.words}"
            // The hollow working marker, still: it does not spin (spec, motion).
            is Line.Working -> "○  ${line.words}"
            else -> line.words
        }
        val (px, color, bold) = when (line) {
            is Line.Tag -> Triple(size.label, LIGHT_2, true)
            is Line.Title -> Triple(size.value, LIGHT_1, true)
            is Line.Text, is Line.Working -> Triple(size.text, LIGHT_1, false)
            is Line.Note -> Triple(size.label, LIGHT_2, false)
        }
        setTextSize(TypedValue.COMPLEX_UNIT_PX, px)
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 0, 0, size.dp(12f))
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

        // docs/design tokens: stage, stage-raised, light-1, light-2, light-3, ink.
        val STAGE = Color.parseColor("#000000")
        val STAGE_RAISED = Color.parseColor("#17171c")
        val LIGHT_1 = Color.parseColor("#f6f4ef")
        val LIGHT_2 = Color.parseColor("#bdbab2")
        val LIGHT_3 = Color.parseColor("#9a978f")
        val INK = Color.parseColor("#000000")
    }
}
