package org.classbeat.player.mode

/** What the unpair question has the edge do. ModeController implements it. */
interface UnpairSteps {
    /** Shows the native "Unpair this phone?" question with its two keys. */
    fun showQuestion(stay: () -> Unit, unpair: () -> Unit)

    /** "Stay", Back or leaving the app: the edge's shared stay, which closes this question. */
    fun stay()

    /** Takes the question down and answers the page's call with [result]. */
    fun answer(result: String)

    /** Deletes the device token and the classes saved on this phone (InstructorIntents.unpair). */
    fun unpair()
}

/**
 * Instructor mode's "Unpair this phone?" question (issue #651), apart from the Android edge so it
 * runs on the JVM (#668). It asks first, and only "Unpair" deletes anything: "Stay", Back and
 * leaving the app keep the pairing. The page hears "unpaired" before anything is deleted.
 */
class UnpairQuestion(private val steps: UnpairSteps) {
    /** The question shows and has not been answered. */
    var showing = false
        private set

    /** Shows the question; the edge has already refused it when anything else is open. */
    fun ask() {
        showing = true
        steps.showQuestion(stay = steps::stay, unpair = ::confirmed)
    }

    /** The question went another way (Stay, Back, leaving the app, or the bridge closed): "Unpair" now does nothing. */
    fun close() {
        showing = false
    }

    /** "Unpair": once, and only while the question shows. */
    private fun confirmed() {
        if (!showing) return
        showing = false
        steps.answer(UNPAIRED)
        steps.unpair()
    }

    private companion object {
        const val UNPAIRED = "unpaired"
    }
}
