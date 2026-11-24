package org.classbeat.player.mode

import org.classbeat.player.policy.Mode
import org.classbeat.player.policy.ModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ModeHolderTest {
    /** Everything the holder did, in order: store writes, effects and drops. */
    private val log = mutableListOf<String>()

    private class Store(var value: String?, val log: MutableList<String>, var fails: Boolean = false) : ModeStore {
        override fun read() = value

        override fun write(value: String) {
            if (fails) error("disk full")
            this.value = value
            log += "write $value"
        }

        /** The wipe flag; not logged, so the logs above stay exact. */
        var wipe = false
        var flagFails = false

        override fun wipePending() = wipe

        override fun setWipePending(pending: Boolean) {
            if (flagFails) error("disk full")
            wipe = pending
        }
    }

    private class FakeDevice(override var paired: Boolean, override var secureLock: Boolean) : Device

    private inner class Effects : ModeEffects {
        override fun closeBridge() { log += "close" }
        override fun open(mode: Mode) { log += "open $mode" }
        override fun askLock() { log += "askLock" }
        override fun showNoLock() { log += "noLock" }
        override fun askRiderQuestion() { log += "question" }
        override fun showSwitching(mode: Mode) { log += "switching $mode" }
        override fun fatal(failed: List<String>) { log += "fatal $failed" }
    }

    /** State each part holds; a drop empties it. */
    private val state = ModePolicy.TEARDOWN.associateWith { mutableListOf("left") }
    private val failing = mutableSetOf<String>()

    /** Parts whose drop finishes only when the test says so, as the web view's storage wipe does. */
    private val later = mutableSetOf<String>()
    private val unfinished = mutableMapOf<String, (Throwable?) -> Unit>()

    private val parts = ModePolicy.TEARDOWN.map { name ->
        Teardown(name) { done ->
            if (name in failing) error("stuck")
            log += "drop $name"
            val finish = { error: Throwable? ->
                if (error == null) state.getValue(name).clear()
                log += "dropped $name"
                done(error)
            }
            if (name in later) unfinished[name] = finish else finish(null)
        }
    }

    /** Every drop, started and finished, in TEARDOWN order. */
    private fun drops() = ModePolicy.TEARDOWN.flatMap { listOf("drop $it", "dropped $it") }

    private fun holder(stored: String?, paired: Boolean, lock: Boolean, store: Store = Store(stored, log)): Pair<ModeHolder, FakeDevice> {
        val device = FakeDevice(paired, lock)
        return ModeHolder(store, device, Effects(), parts) to device
    }

    private fun instructor(): ModeHolder {
        val (h, _) = holder("instructor", paired = true, lock = true)
        h.start()
        assertEquals(Mode.INSTRUCTOR, h.current)
        state.values.forEach { it += "instructor" }
        log.clear()
        return h
    }

    @Test
    fun `a first launch on an unpaired device is in rider mode`() {
        val store = Store(null, log)
        val (h, _) = holder(null, paired = false, lock = true, store = store)
        assertEquals(Mode.RIDER, h.start())
        assertEquals("rider", store.value)
        assertEquals(listOf("write rider", "open RIDER"), log)
    }

    @Test
    fun `the app reopens in the last mode used`() {
        assertEquals(Mode.INSTRUCTOR, holder("instructor", paired = true, lock = true).first.start())
        assertEquals(Mode.RIDER, holder("rider", paired = true, lock = true).first.start())
    }

    @Test
    fun `a restart in rider mode on a paired device still needs the lock`() {
        // The last session ended in instructor mode, then switched to rider: the store says rider.
        val (h, _) = holder("rider", paired = true, lock = true)
        h.start()
        log.clear()
        assertFalse(h.lockAnswered(true))
        assertEquals(Mode.RIDER, h.current)
        assertEquals(ModePolicy.Entry.ASK_LOCK, h.askInstructor())
        assertEquals(listOf("askLock"), log)
        assertEquals(Mode.RIDER, h.current)
        assertFalse(h.lockAnswered(false))
        assertEquals(Mode.RIDER, h.current)
        // A second answer to the same prompt opens nothing: the prompt is asked again each time.
        assertFalse(h.lockAnswered(true))
        assertEquals(Mode.RIDER, h.current)
        h.askInstructor()
        assertTrue(h.lockAnswered(true))
        assertEquals(Mode.INSTRUCTOR, h.current)
    }

    @Test
    fun `a lock passed after the device lost its pairing or lock opens nothing`() {
        for (lose in listOf("pairing", "lock")) {
            val (h, device) = holder("rider", paired = true, lock = true)
            h.start()
            h.askInstructor()
            if (lose == "pairing") device.paired = false else device.secureLock = false
            assertFalse(lose, h.lockAnswered(true))
            assertEquals(lose, Mode.RIDER, h.current)
        }
    }

    @Test
    fun `an unpaired device goes to pairing and nothing opens`() {
        val (h, _) = holder(null, paired = false, lock = true)
        h.start()
        log.clear()
        assertEquals(ModePolicy.Entry.PAIR, h.askInstructor())
        assertTrue(log.isEmpty())
        assertNull(h.pending)
    }

    @Test
    fun `with no secure lock the app refuses and offers to set one`() {
        val (h, device) = holder("rider", paired = true, lock = false)
        h.start()
        log.clear()
        assertEquals(ModePolicy.Entry.NO_LOCK, h.askInstructor())
        assertEquals(listOf("noLock"), log)
        assertFalse(h.lockAnswered(true))
        // Back from the settings without a lock: the same screen again.
        h.noLockReturned()
        assertEquals(listOf("noLock", "noLock"), log)
        // Back with a lock set: the prompt.
        device.secureLock = true
        h.noLockReturned()
        assertEquals(listOf("noLock", "noLock", "askLock"), log)
        assertTrue(h.lockAnswered(true))
        assertEquals(Mode.INSTRUCTOR, h.current)
    }

    @Test
    fun `staying in rider mode from the no-lock screen ends the question`() {
        val (h, device) = holder("rider", paired = true, lock = false)
        h.start()
        h.askInstructor()
        h.noLockStay()
        device.secureLock = true
        h.noLockReturned()
        assertNull(h.pending)
        assertFalse(log.contains("askLock"))
    }

    @Test
    fun `no instructor state survives a switch to rider mode`() {
        val h = instructor()
        assertTrue(h.askRider())
        assertEquals(listOf("question"), log)
        assertTrue(h.riderAnswered(true))
        assertEquals(Mode.RIDER, h.current)
        assertTrue(state.values.all { it.isEmpty() })
        val expected = listOf("close", "switching RIDER", "write rider") + drops() + "open RIDER"
        assertEquals(expected, log.drop(1))
    }

    @Test
    fun `a switch to instructor mode drops everything too, the rider's numbers included`() {
        val (h, _) = holder("rider", paired = true, lock = true)
        h.start()
        state.values.forEach { it += "rider" }
        log.clear()
        h.askInstructor()
        h.lockAnswered(true)
        assertTrue(state.values.all { it.isEmpty() })
        val expected = listOf("askLock", "close", "switching INSTRUCTOR") + drops() +
            listOf("write instructor", "open INSTRUCTOR")
        assertEquals(expected, log)
    }

    @Test
    fun `staying, or a question not asked, switches nothing`() {
        val h = instructor()
        assertFalse(h.riderAnswered(true))
        h.askRider()
        assertFalse(h.riderAnswered(false))
        assertEquals(Mode.INSTRUCTOR, h.current)
        assertFalse(h.riderAnswered(true))
        assertEquals(listOf("question"), log)
    }

    @Test
    fun `each mode asks only for the other`() {
        val h = instructor()
        assertNull(h.askInstructor())
        val (r, _) = holder("rider", paired = true, lock = true)
        r.start()
        assertFalse(r.askRider())
    }

    @Test
    fun `a part that cannot be dropped stops the app and opens no page`() {
        for (name in ModePolicy.TEARDOWN) {
            failing.clear()
            failing += name
            val h = instructor()
            h.askRider()
            assertFalse(h.riderAnswered(true))
            assertNull(h.current)
            assertEquals(name, "fatal [$name]", log.last())
            assertFalse(log.any { it.startsWith("open") })
            // Every other part was still dropped.
            assertTrue(state.filterKeys { it != name }.values.all { it.isEmpty() })
        }
    }

    @Test
    fun `a store that cannot be written stops the switch, and instructor mode is never written early`() {
        val store = Store("rider", log)
        val (h, _) = holder("rider", paired = true, lock = true, store = store)
        h.start()
        failing += "webStorage"
        h.askInstructor()
        assertFalse(h.lockAnswered(true))
        assertEquals("rider", store.value)
        assertFalse(log.contains("write instructor"))
        failing.clear()
        val failingStore = Store("instructor", log)
        val (j, _) = holder("instructor", paired = true, lock = true, store = failingStore)
        j.start()
        failingStore.fails = true
        j.askRider()
        assertFalse(j.riderAnswered(true))
        assertNull(j.current)
        assertEquals("fatal [${ModeHolder.STORE}]", log.last())
    }

    @Test
    fun `nothing can be asked while the app is between modes`() {
        failing += "follower"
        val h = instructor()
        h.askRider()
        h.riderAnswered(true)
        assertNull(h.current)
        assertNull(h.askInstructor())
        assertFalse(h.askRider())
        assertFalse(h.lockAnswered(true))
    }

    @Test
    fun `the holder refuses to start without exactly the teardown parts`() {
        val store = Store(null, log)
        val device = FakeDevice(paired = false, secureLock = false)
        for (bad in listOf(parts.drop(1), parts.reversed(), parts + Teardown("extra") { it(null) }, parts.filter { it.name != "riderNumbers" })) {
            assertThrows(IllegalArgumentException::class.java) { ModeHolder(store, device, Effects(), bad) }
        }
    }

    @Test
    fun `the page opens only after a drop that finishes later has finished`() {
        later += "webStorage"
        val h = instructor()
        h.askRider()
        assertTrue(h.riderAnswered(true))
        // Still dropping: between modes, nothing opened, nothing can be asked.
        assertNull(h.current)
        assertFalse(log.any { it.startsWith("open") })
        assertFalse(h.askRider())
        assertNull(h.askInstructor())
        assertEquals(listOf("left", "instructor"), state.getValue("webStorage"))
        unfinished.getValue("webStorage")(null)
        assertEquals(Mode.RIDER, h.current)
        assertEquals(listOf("dropped webStorage", "open RIDER"), log.takeLast(2))
        assertTrue(state.values.all { it.isEmpty() })
    }

    @Test
    fun `instructor mode is written only after a drop that finishes later has finished`() {
        later += "webStorage"
        val store = Store("rider", log)
        val (h, _) = holder("rider", paired = true, lock = true, store = store)
        h.start()
        h.askInstructor()
        assertTrue(h.lockAnswered(true))
        assertEquals("rider", store.value)
        unfinished.getValue("webStorage")(null)
        assertEquals("instructor", store.value)
        assertEquals(listOf("dropped webStorage", "write instructor", "open INSTRUCTOR"), log.takeLast(3))
    }

    @Test
    fun `a drop that fails later stops the app, and a second answer from it counts for nothing`() {
        later += "webStorage"
        val h = instructor()
        h.askRider()
        h.riderAnswered(true)
        val finish = unfinished.getValue("webStorage")
        finish(IllegalStateException("left"))
        assertEquals("fatal [webStorage]", log.last())
        finish(null)
        assertNull(h.current)
        assertFalse(log.any { it.startsWith("open") })
    }

    @Test
    fun `a start after a switch cut short drops everything before any page loads`() {
        for (stored in listOf("rider", "instructor")) {
            log.clear()
            state.values.forEach { it.clear(); it += "left" }
            val store = Store(stored, log).apply { wipe = true }
            val (h, _) = holder(stored, paired = true, lock = true, store = store)
            val mode = h.start()
            assertTrue(stored, state.values.all { it.isEmpty() })
            val opened = log.indexOfFirst { it.startsWith("open") }
            assertTrue(stored, opened > log.indexOf("dropped ${ModePolicy.TEARDOWN.last()}"))
            assertEquals(stored, "open $mode", log.last())
            assertFalse(stored, store.wipe)
        }
    }

    @Test
    fun `a switch the app was killed in leaves the flag, and the next start finishes the wipe`() {
        later += "webStorage"
        val store = Store("instructor", log)
        val (h, _) = holder("instructor", paired = true, lock = true, store = store)
        h.start()
        state.values.forEach { it += "instructor" }
        h.askRider()
        h.riderAnswered(true)
        // Killed here: webStorage never finished.
        assertTrue(store.wipe)
        assertEquals("rider", store.value)
        later.clear()
        state.getValue("webStorage").add("still here")
        log.clear()
        val (next, _) = holder("rider", paired = true, lock = true, store = store)
        assertEquals(Mode.RIDER, next.start())
        assertTrue(state.getValue("webStorage").isEmpty())
        assertTrue(log.indexOf("dropped webStorage") < log.indexOf("open RIDER"))
        assertFalse(store.wipe)
    }

    @Test
    fun `a flag that cannot be written stops the switch`() {
        val store = Store("instructor", log)
        val (h, _) = holder("instructor", paired = true, lock = true, store = store)
        h.start()
        log.clear()
        store.flagFails = true
        h.askRider()
        assertFalse(h.riderAnswered(true))
        assertEquals("rider", store.value)
        assertEquals("fatal [${ModeHolder.STORE}]", log.last())
        assertFalse(log.any { it.startsWith("open") })
    }

    @Test
    fun `a second answer from one drop opens nothing while another drop is still pending`() {
        later += listOf("webStorage", "follower")
        val h = instructor()
        h.askRider()
        assertTrue(h.riderAnswered(true))
        val web = unfinished.getValue("webStorage")
        web(null)
        web(null)
        assertNull(h.current)
        assertFalse(log.any { it.startsWith("open") })
        unfinished.getValue("follower")(null)
        assertEquals(Mode.RIDER, h.current)
        assertEquals(1, log.count { it.startsWith("open") })
    }

    @Test
    fun `unpairing in instructor mode switches to rider mode with no question`() {
        val h = instructor()
        h.unpaired()
        assertEquals(Mode.RIDER, h.current)
        assertFalse(log.contains("question"))
        assertTrue(state.values.all { it.isEmpty() })
        val (r, _) = holder("rider", paired = true, lock = true)
        r.start()
        log.clear()
        r.unpaired()
        assertTrue(log.isEmpty())
    }
}
