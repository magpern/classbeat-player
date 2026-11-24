package org.classbeat.player.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModePolicyTest {
    private val bools = listOf(false, true)

    @Test
    fun `a first launch, or any value but instructor, opens in rider mode`() {
        for (stored in listOf(null, "", "rider", "Instructor", "instructor ", "room", "unlocked")) {
            for (paired in bools) for (lock in bools) {
                assertEquals(Mode.RIDER, ModePolicy.startMode(stored, paired, lock))
            }
        }
    }

    @Test
    fun `instructor mode reopens only while still paired and locked`() {
        assertEquals(Mode.INSTRUCTOR, ModePolicy.startMode("instructor", paired = true, secureLock = true))
        assertEquals(Mode.RIDER, ModePolicy.startMode("instructor", paired = false, secureLock = true))
        assertEquals(Mode.RIDER, ModePolicy.startMode("instructor", paired = true, secureLock = false))
    }

    @Test
    fun `the way in is pairing, then a lock, then the prompt`() {
        assertEquals(ModePolicy.Entry.PAIR, ModePolicy.entry(paired = false, secureLock = true))
        assertEquals(ModePolicy.Entry.PAIR, ModePolicy.entry(paired = false, secureLock = false))
        assertEquals(ModePolicy.Entry.NO_LOCK, ModePolicy.entry(paired = true, secureLock = false))
        assertEquals(ModePolicy.Entry.ASK_LOCK, ModePolicy.entry(paired = true, secureLock = true))
    }

    @Test
    fun `only an asked, passed prompt on a paired, locked device opens instructor mode`() {
        for (a in bools) for (p in bools) for (d in bools) for (l in bools) {
            assertEquals(a && p && d && l, ModePolicy.opensInstructor(a, p, d, l))
        }
    }

    @Test
    fun `the two modes share no page and nothing shows between modes`() {
        val rider = ModePolicy.pages(Mode.RIDER).toSet()
        val instructor = ModePolicy.pages(Mode.INSTRUCTOR).toSet()
        assertTrue(rider.intersect(instructor).isEmpty())
        assertEquals("/rider.html", ModePolicy.startPage(Mode.RIDER))
        assertEquals("/instructor.html", ModePolicy.startPage(Mode.INSTRUCTOR))
        for (path in rider + instructor + listOf("/", "/index.html")) assertFalse(ModePolicy.mayShow(null, path))
        assertFalse(ModePolicy.mayShow(Mode.RIDER, "/room.html"))
        assertFalse(ModePolicy.mayShow(Mode.RIDER, "/instructor.html"))
        assertFalse(ModePolicy.mayShow(Mode.INSTRUCTOR, "/rider.html"))
        assertTrue(ModePolicy.mayShow(Mode.INSTRUCTOR, "/room.html"))
        for (mode in Mode.entries) assertFalse(ModePolicy.mayShow(mode, "/index.html"))
    }

    @Test
    fun `a switch drops the rider's numbers as well as everything of the instructor's`() {
        assertEquals(
            listOf("follower", "connections", "instructorState", "riderSession", "riderNumbers", "webStorage"),
            ModePolicy.TEARDOWN,
        )
    }
}
