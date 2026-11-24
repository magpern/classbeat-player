package org.classbeat.player.mode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One question at a time (issue #673): a rider-mode ask during the unpair question, or the reverse,
 * is refused and the open question's call still gets its one answer. The unpair side is the real
 * UnpairQuestion, wired as ModeController wires it; the rider question is a stand-in for the holder's.
 */
class PageQuestionTest {
    /** What each page call heard, and when the pairing was cleared. */
    private val log = mutableListOf<String>()
    private val question = PageQuestion<String>({ call, result -> log += "$call $result" }, { log += "$it refused" })

    private var stayKey: () -> Unit = {}
    private var unpairKey: () -> Unit = {}

    /** The edge's unpair steps, as ModeController has them: Stay closes the question and answers "stayed". */
    private val unpairing: UnpairQuestion = UnpairQuestion(
        object : UnpairSteps {
            override fun showQuestion(stay: () -> Unit, unpair: () -> Unit) {
                stayKey = stay
                unpairKey = unpair
            }

            override fun stay() {
                unpairing.close()
                riderShowing = false
                question.settle("stayed")
            }

            override fun answer(result: String) = question.settle(result)

            override fun unpair() {
                log += "pairing cleared"
            }
        },
    )

    /** The holder's rider question: it shows until answered. */
    private var riderShowing = false

    private fun askUnpair() = question.ask("unpair") { true.also { unpairing.ask() } }

    private fun askRider() = question.ask("rider") { true.also { riderShowing = true } }

    @Test
    fun `a rider ask during the unpair question is refused, and Stay answers the unpair call and keeps the pairing`() {
        askUnpair()
        askRider()
        assertEquals(listOf("rider refused"), log)
        assertFalse(riderShowing)
        assertTrue(unpairing.showing)
        stayKey()
        assertEquals(listOf("rider refused", "unpair stayed"), log)
        assertFalse(question.open)
    }

    @Test
    fun `a rider ask during the unpair question is refused, and Unpair answers the unpair call then clears the pairing`() {
        askUnpair()
        askRider()
        unpairKey()
        assertEquals(listOf("rider refused", "unpair unpaired", "pairing cleared"), log)
        assertFalse(question.open)
    }

    @Test
    fun `an unpair ask during the rider question is refused, shows nothing and clears nothing`() {
        askRider()
        askUnpair()
        assertEquals(listOf("unpair refused"), log)
        assertFalse(unpairing.showing)
        unpairKey()
        assertEquals(listOf("unpair refused"), log)
        question.settle("stayed")
        assertEquals(listOf("unpair refused", "rider stayed"), log)
    }

    @Test
    fun `a refused show refuses the call and holds nothing`() {
        question.ask("rider") { false }
        assertFalse(question.open)
        askUnpair()
        stayKey()
        assertEquals(listOf("rider refused", "unpair stayed"), log)
    }

    @Test
    fun `an answer that comes back while the question shows reaches its call once`() {
        question.ask("instructor") { true.also { question.settle("notConfirmed") } }
        question.settle("stayed")
        assertEquals(listOf("instructor notConfirmed"), log)
        assertFalse(question.open)
    }

    @Test
    fun `dropping answers the open call with the refused word, once`() {
        askUnpair()
        question.drop()
        question.drop()
        question.settle("stayed")
        assertEquals(listOf("unpair refused"), log)
    }
}
