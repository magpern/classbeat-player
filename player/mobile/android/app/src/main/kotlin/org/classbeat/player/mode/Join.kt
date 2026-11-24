package org.classbeat.player.mode

/**
 * Joins the answers of several jobs that finish in the background into one [done]: called once,
 * after [started] and after every [part] has answered, with the first error any of them gave.
 * A part that answers twice counts once. Pure; every answer comes on the same thread.
 */
class Join(private val done: (Throwable?) -> Unit) {
    private var open = 0
    private var started = false
    private var answered = false
    private var error: Throwable? = null

    /** One more job: call the returned function when it finishes. */
    fun part(): (Throwable?) -> Unit {
        check(!started) { "a part was added after started" }
        open += 1
        var finished = false
        return { e ->
            if (!finished) {
                finished = true
                if (error == null) error = e
                open -= 1
                settle()
            }
        }
    }

    /** No more parts: [done] comes once they have all answered. */
    fun started() {
        started = true
        settle()
    }

    private fun settle() {
        if (!started || open > 0 || answered) return
        answered = true
        done(error)
    }
}
