package org.classbeat.player.mode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web view's storage wipe is done only when every part of it has finished (review of PR #643). */
class JoinTest {
    private val answers = mutableListOf<Throwable?>()
    private val join = Join { answers += it }

    @Test
    fun `done comes once, only after started and every part`() {
        val a = join.part()
        val b = join.part()
        a(null)
        assertTrue(answers.isEmpty())
        join.started()
        assertTrue(answers.isEmpty())
        b(null)
        assertEquals(listOf<Throwable?>(null), answers)
        a(null)
        b(null)
        assertEquals(1, answers.size)
    }

    @Test
    fun `parts that finished before started still wait for started`() {
        join.part()(null)
        assertTrue(answers.isEmpty())
        join.started()
        assertEquals(listOf<Throwable?>(null), answers)
    }

    @Test
    fun `a part answering twice does not stand in for another`() {
        val a = join.part()
        join.part()
        join.started()
        a(null)
        a(null)
        assertTrue(answers.isEmpty())
    }

    @Test
    fun `the first error is the answer`() {
        val first = IllegalStateException("one")
        val a = join.part()
        val b = join.part()
        join.started()
        a(first)
        b(IllegalStateException("two"))
        assertEquals(listOf<Throwable?>(first), answers)
    }

    @Test
    fun `no part may be added after started`() {
        join.started()
        assertThrows(IllegalStateException::class.java) { join.part() }
    }
}
