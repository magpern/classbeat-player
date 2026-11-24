package org.classbeat.player.mode

/**
 * The one page call a native question answers (issue #673), apart from the Android edge so it runs
 * on the JVM. Only one question is open at a time. A call that arrives while one is open is refused
 * at once and changes nothing: the open question stays as it is and its own call still gets its
 * answer, so no call is ever left without one (a rider-mode request during the unpair question used
 * to take the unpair call's place). [resolve] answers a call with a result word, [refuse] with the
 * one refused word.
 */
class PageQuestion<C : Any>(private val resolve: (C, String) -> Unit, private val refuse: (C) -> Unit) {
    private var waiting: C? = null

    /** A question is open and its call not yet answered. */
    val open: Boolean get() = waiting != null

    /**
     * Holds [call] and runs [show], the question's own checks and its screen. [show] returns false
     * when it refused, and the call is then refused and nothing held. The call is held before [show]
     * runs, so an answer that comes back at once (no screen lock to ask) still reaches it.
     */
    fun ask(call: C, show: () -> Boolean) {
        if (waiting != null) return refuse(call)
        waiting = call
        if (show()) return
        if (waiting === call) {
            waiting = null
            refuse(call)
        }
    }

    /** The question was answered: its call hears [result], once. */
    fun settle(result: String) {
        val call = waiting ?: return
        waiting = null
        resolve(call, result)
    }

    /** The page that asked is being replaced: its call hears the refused word, once. */
    fun drop() {
        val call = waiting ?: return
        waiting = null
        refuse(call)
    }
}
