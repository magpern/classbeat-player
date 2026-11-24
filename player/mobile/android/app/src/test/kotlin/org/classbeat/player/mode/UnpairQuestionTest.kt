package org.classbeat.player.mode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The "Unpair this phone?" question (issue #651, #668): Stay keeps the pairing, only Unpair clears it. */
class UnpairQuestionTest {
    private val log = mutableListOf<String>()
    private var stayKey: () -> Unit = {}
    private var unpairKey: () -> Unit = {}

    /** A fake edge: the pairing is "cleared" only by [unpair]; [stay] closes the question as the real edge does. */
    private inner class Edge : UnpairSteps {
        lateinit var question: UnpairQuestion

        override fun showQuestion(stay: () -> Unit, unpair: () -> Unit) {
            log += "show"
            stayKey = stay
            unpairKey = unpair
        }

        override fun stay() {
            log += "stay"
            question.close()
        }

        override fun answer(result: String) {
            log += "answer $result"
        }

        override fun unpair() {
            log += "unpair"
        }
    }

    private fun question(): UnpairQuestion {
        val edge = Edge()
        return UnpairQuestion(edge).also { edge.question = it }
    }

    @Test
    fun `asking shows the question and deletes nothing`() {
        val q = question()
        q.ask()
        assertTrue(q.showing)
        assertEquals(listOf("show"), log)
    }

    @Test
    fun `Stay keeps the pairing, and Unpair tapped afterwards does nothing`() {
        val q = question()
        q.ask()
        stayKey()
        assertFalse(q.showing)
        unpairKey()
        assertEquals(listOf("show", "stay"), log)
    }

    @Test
    fun `Unpair answers unpaired first and then clears the pairing, once`() {
        val q = question()
        q.ask()
        unpairKey()
        assertFalse(q.showing)
        assertEquals(listOf("show", "answer unpaired", "unpair"), log)
        unpairKey()
        assertEquals(listOf("show", "answer unpaired", "unpair"), log)
    }

    @Test
    fun `Unpair after the question was closed (Back, leaving the app, bridge closed) clears nothing`() {
        val q = question()
        q.ask()
        q.close()
        unpairKey()
        assertEquals(listOf("show"), log)
    }
}
