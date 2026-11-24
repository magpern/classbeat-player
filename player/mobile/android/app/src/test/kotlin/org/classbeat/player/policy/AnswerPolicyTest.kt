package org.classbeat.player.policy

import org.classbeat.player.fake.Secrets
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnswerPolicyTest {
    private val secrets = listOf(Secrets.token('Q'), Secrets.deviceCode('R'))

    @Test
    fun `an answer with no secret may go`() {
        assertTrue(AnswerPolicy.mayAnswer(mapOf("classes" to listOf(mapOf("title" to "Alpha")), "status" to "synced"), secrets))
        assertTrue(AnswerPolicy.mayAnswer(null, emptyList()))
    }

    @Test
    fun `a secret anywhere, whole or in part, is refused`() {
        for (s in secrets) {
            assertFalse(AnswerPolicy.mayAnswer(mapOf("a" to s), secrets))
            assertFalse(AnswerPolicy.mayAnswer(mapOf("a" to listOf(mapOf("b" to "x" + s.substring(9, 21) + "y"))), secrets))
            assertFalse(AnswerPolicy.mayAnswer(mapOf(s.takeLast(12) to 1), secrets))
        }
    }

    @Test
    fun `an answer that cannot be written is refused`() {
        assertFalse(AnswerPolicy.mayAnswer(mapOf("a" to Any()), secrets))
    }
}
