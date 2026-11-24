package org.classbeat.player.pairing

import org.classbeat.player.mode.ScreenLine
import org.classbeat.player.pairing.PairingMachine.Notice
import org.classbeat.player.pairing.PairingScreenModel.Action
import org.classbeat.player.pairing.PairingScreenModel.screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingScreenModelTest {
    private val waiting = PairingView.Waiting("BCDF-GHJK", "https://classbeat.test/pair", 600_000)

    private fun actions(s: PairingScreenModel.Screen) = s.keys.map { it.action }

    @Test
    fun `asking shows the working line and Cancel alone`() {
        val s = screen(PairingView.Starting, 0, true, false, false)
        assertEquals(ScreenLine.Tag("Instructor mode"), s.lead[0])
        assertEquals(ScreenLine.Title("Pair this phone"), s.lead[1])
        assertTrue(ScreenLine.Working("Asking the server for a code") in s.lead)
        assertEquals(listOf(Action.CANCEL), actions(s))
    }

    @Test
    fun `the code counts down, with the steps and the address in full`() {
        val s = screen(waiting, 19_000, true, false, false)
        assertTrue(ScreenLine.Code("BCDF-GHJK") in s.lead)
        assertTrue(ScreenLine.Text("The code runs out in 9:41") in s.lead)
        assertEquals(ScreenLine.Step(1, "Open https://classbeat.test/pair"), s.act[0])
        assertEquals(3, s.act.size)
        assertEquals(listOf("Open the site" to true, "Cancel" to false), s.keys.map { it.label to it.main })
        assertFalse(s.lines.any { it is ScreenLine.Note })
        assertEquals("0:00", PairingScreenModel.left(600_000, 700_000))
        assertEquals("0:01", PairingScreenModel.left(600_000, 599_500))
    }

    @Test
    fun `no screen lock adds the grey note, and back from the browser the waiting line`() {
        val s = screen(waiting, 0, false, true, false)
        assertTrue(s.lead.any { it is ScreenLine.Note && it.words.startsWith("This phone has no screen lock.") })
        assertTrue(ScreenLine.Working("Not yet confirmed on the website") in s.lead)
        assertEquals("Open the page again", s.keys[0].label)
        assertEquals(Action.OPEN, s.keys[0].action)
    }

    @Test
    fun `paired says who, and asks for the lock only from rider mode`() {
        val rider = screen(PairingView.Paired("coach@example.test", "Phone", false, null), 0, true, false, false)
        assertTrue(ScreenLine.Text("Paired as coach@example.test") in rider.lead)
        assertTrue(ScreenLine.Text("Confirm your screen lock to open instructor mode.") in rider.lead)
        assertEquals(listOf(Action.CONTINUE), actions(rider))
        val instructor = screen(PairingView.Paired("coach@example.test", "Phone", false, null), 0, true, false, true)
        assertFalse(ScreenLine.Text("Confirm your screen lock to open instructor mode.") in instructor.lead)
    }

    @Test
    fun `every ending has its plate, and no Keystore has one key back`() {
        val heads = mapOf(
            Notice.DENIED to "Refused on the website.",
            Notice.CODE_EXPIRED to "The code ran out.",
            Notice.UNREACHABLE to "The server could not be reached.",
            Notice.NO_SERVER to "The server could not be reached.",
            Notice.TOO_MANY to "Too many pairings were started.",
            Notice.UNEXPECTED to "The answer was not understood.",
            Notice.SAVE_FAILED to "The pairing could not be kept.",
            Notice.REVOKED_ON_SITE to "Unpaired on the website.",
        )
        for ((notice, head) in heads) {
            val s = screen(PairingView.Unpaired(notice), 0, true, false, false)
            assertEquals(notice.name, head, (s.lead.last() as ScreenLine.Plate).head)
            assertEquals(notice.name, listOf(Action.START_AGAIN, Action.RIDER), actions(s))
        }
        val none = screen(PairingView.Unpaired(Notice.NO_KEYSTORE), 0, true, false, false)
        assertEquals("This phone cannot be paired.", (none.lead.last() as ScreenLine.Plate).head)
        assertEquals(listOf("Back to rider mode"), none.keys.map { it.label })
        assertEquals(listOf(Action.RIDER), actions(none))
    }

    @Test
    fun `a pair again that failed shows its plate over the expired pairing`() {
        val s = screen(PairingView.Paired("coach@example.test", null, true, Notice.DENIED), 0, true, false, true)
        assertEquals("Refused on the website.", (s.lead.last() as ScreenLine.Plate).head)
        assertEquals(listOf(Action.CANCEL), actions(screen(PairingView.Unpaired(Notice.UNPAIRED), 0, true, false, false)))
    }
}
