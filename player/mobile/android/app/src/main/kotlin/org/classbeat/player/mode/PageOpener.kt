package org.classbeat.player.mode

import org.classbeat.player.policy.Mode
import org.classbeat.player.policy.ModePolicy

/** What the opener has the bridge and the web view do. The Android edge implements it (ModeController). */
interface PageSteps {
    /** Puts [mode]'s plugin, and only that one, on the bridge; null takes every plugin off. */
    fun expose(mode: Mode?)

    /** Loads the bundled page at [path] in the main frame. */
    fun load(path: String)

    /** The mode's start page has committed: its history starts here and the native screen can go. */
    fun ready()
}

/**
 * Puts a mode's start page up without letting any other page reach that mode's intents (issue
 * #630). The last mode's page keeps running until a new document commits, so a mode's plugin goes
 * on the bridge only once the blank page, which runs no script of ours, has replaced it:
 *
 * 1. every plugin off, then load the blank page;
 * 2. the blank page committed: the last page is gone, so put the mode's plugin on and load its start page;
 * 3. the start page committed: [PageSteps.ready].
 *
 * Pure; the edge calls it on the main thread only.
 */
class PageOpener(private val steps: PageSteps) {
    private var stage: Stage? = null

    private sealed interface Stage {
        val mode: Mode

        /** Waiting for the blank page to commit. Every plugin is off. */
        data class Clearing(override val mode: Mode) : Stage

        /** The blank page is up and [mode]'s plugin on; waiting for its start page to commit. */
        data class Starting(override val mode: Mode) : Stage
    }

    /** Opens [mode]'s start page fresh, by way of the blank page. */
    fun open(mode: Mode) {
        stage = Stage.Clearing(mode)
        steps.expose(null)
        steps.load(BLANK)
    }

    /**
     * Whether a main-frame page at [path] may load. While the last page is being cleared only the
     * blank page may, so no page of either mode can take its place; otherwise null, and
     * ModePolicy.mayShow decides.
     */
    fun mayShow(path: String): Boolean? = if (stage is Stage.Clearing) path == BLANK else null

    /** A main-frame page at [path] committed. */
    fun committed(path: String) {
        when (val now = stage) {
            is Stage.Clearing -> if (path == BLANK) {
                stage = Stage.Starting(now.mode)
                steps.expose(now.mode)
                steps.load(ModePolicy.startPage(now.mode))
            }
            is Stage.Starting -> if (path == ModePolicy.startPage(now.mode)) {
                stage = null
                steps.ready()
            }
            null -> Unit
        }
    }

    companion object {
        /** The bundled blank page: no script or style of ours (test/shell-config.test.ts). */
        const val BLANK = "/index.html"
    }
}
