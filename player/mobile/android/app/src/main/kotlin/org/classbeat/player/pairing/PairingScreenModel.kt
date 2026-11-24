package org.classbeat.player.pairing

import org.classbeat.player.mode.ScreenLine
import org.classbeat.player.pairing.PairingMachine.Notice

/**
 * What the native pairing screen shows for each pairing state (docs/design/app-pairing.md). Pure:
 * it reads only [PairingView], which holds no token and no device code, so no line can carry one.
 */
object PairingScreenModel {
    enum class Action { CANCEL, OPEN, CONTINUE, RIDER, START_AGAIN }

    data class Key(val label: String, val main: Boolean, val action: Action)

    /** [lead] goes first (and left in landscape); [act] (the steps) goes with the keys. */
    data class Screen(val lead: List<ScreenLine>, val act: List<ScreenLine>, val keys: List<Key>) {
        val lines: List<ScreenLine> get() = lead + act
    }

    private val TAG = ScreenLine.Tag("Instructor mode")
    private val TITLE = ScreenLine.Title("Pair this phone")
    private val NO_LOCK = ScreenLine.Note("This phone has no screen lock. Instructor mode will need one: set it before or after pairing.")
    private val PLATE_KEYS = listOf(Key("Start again", true, Action.START_AGAIN), Key("Rider mode", false, Action.RIDER))

    /**
     * [returned] is true once the app came back from the browser while the code showed; [instructor]
     * is true for "pair again" from instructor mode, where no screen lock is asked after pairing.
     */
    /**
     * Whether opening the screen starts a pairing at once. A notice (revoked on the website, a code run out, a
     * failure) is held instead, and only "Start again" begins; "Unpaired" by this phone asks as usual.
     */
    fun begins(view: PairingView): Boolean = view !is PairingView.Unpaired || view.notice == null || view.notice == Notice.UNPAIRED

    fun screen(view: PairingView, now: Long, secureLock: Boolean, returned: Boolean, instructor: Boolean): Screen = when (view) {
        is PairingView.Starting -> asking()
        // Unpaired here (the page's unpair) is no ending to report: the screen opens to pair anew.
        is PairingView.Unpaired -> view.notice?.takeIf { it != Notice.UNPAIRED }?.let(::plate) ?: asking()
        is PairingView.Waiting -> code(view, now, secureLock, returned)
        is PairingView.Paired -> when {
            view.notice != null -> plate(view.notice)
            view.expired -> asking()
            else -> paired(view.email, instructor)
        }
    }

    /** "m:ss" left, rounded up, never below 0:00. */
    fun left(expiresAt: Long, now: Long): String {
        val s = ((expiresAt - now).coerceAtLeast(0) + 999) / 1000
        return "%d:%02d".format(s / 60, s % 60)
    }

    private fun asking() = Screen(listOf(TAG, TITLE, ScreenLine.Working("Asking the server for a code")), emptyList(), listOf(Key("Cancel", false, Action.CANCEL)))

    private fun code(view: PairingView.Waiting, now: Long, secureLock: Boolean, returned: Boolean): Screen {
        val lead = mutableListOf(TAG, TITLE)
        if (returned) lead += ScreenLine.Working("Not yet confirmed on the website")
        lead += ScreenLine.Code(view.userCode)
        lead += ScreenLine.Text("The code runs out in ${left(view.expiresAt, now)}")
        if (!secureLock) lead += NO_LOCK
        val steps = listOf(
            ScreenLine.Step(1, "Open ${view.page}"),
            ScreenLine.Step(2, "Sign in and type the code."),
            ScreenLine.Step(3, "Confirm only if this phone shows the same code."),
        )
        val open = Key(if (returned) "Open the page again" else "Open the site", true, Action.OPEN)
        return Screen(lead, steps, listOf(open, Key("Cancel", false, Action.CANCEL)))
    }

    private fun paired(email: String?, instructor: Boolean): Screen {
        val lead = mutableListOf(TAG, ScreenLine.Title("This phone is paired"))
        if (email != null) lead += ScreenLine.Text("Paired as $email")
        if (!instructor) lead += ScreenLine.Text("Confirm your screen lock to open instructor mode.")
        return Screen(lead, emptyList(), listOf(Key("Continue", true, Action.CONTINUE)))
    }

    private fun plate(notice: Notice): Screen {
        val (head, body) = when (notice) {
            Notice.NO_KEYSTORE -> return Screen(
                listOf(TAG, TITLE, ScreenLine.Plate("This phone cannot be paired.", "It has no Android Keystore, so there is no safe place for the pairing. Rider mode works without it.")),
                emptyList(),
                listOf(Key("Back to rider mode", true, Action.RIDER)),
            )
            Notice.DENIED -> "Refused on the website." to "Nothing was kept on this phone."
            Notice.CODE_EXPIRED -> "The code ran out." to "It was not confirmed in time. Start again for a new code."
            // The build holds no server address (a release built without one): the spec has no
            // state for it, since the address is fixed in the build; to the user it is unreachable.
            Notice.UNREACHABLE, Notice.NO_SERVER -> "The server could not be reached." to "Check the connection, then start again."
            Notice.TOO_MANY -> "Too many pairings were started." to "Try again in an hour."
            Notice.UNEXPECTED -> "The answer was not understood." to "The app could not read the server's answer. Try again later."
            Notice.SAVE_FAILED -> "The pairing could not be kept." to "The Android Keystore did not keep it, so the pairing was undone. Start again."
            Notice.REVOKED_ON_SITE, Notice.UNPAIRED -> "Unpaired on the website." to "The classes saved on this phone were removed."
        }
        return Screen(listOf(TAG, TITLE, ScreenLine.Plate(head, body)), emptyList(), PLATE_KEYS)
    }
}
