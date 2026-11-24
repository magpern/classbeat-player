package org.classbeat.player.policy

import org.classbeat.player.policy.IntentPolicy.Arg
import org.classbeat.player.policy.IntentPolicy.Refusal
import org.classbeat.player.policy.IntentPolicy.Spec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentPolicyTest {
    private val other = mapOf(Mode.RIDER to Mode.INSTRUCTOR, Mode.INSTRUCTOR to Mode.RIDER)

    @Test
    fun `every intent is listed here by hand, with its mode`() {
        // A new intent fails this test until it is added here, with a test of its arguments below.
        val expected = mapOf(
            "instructorWay" to Mode.RIDER,
            "askInstructorMode" to Mode.RIDER,
            "askRiderMode" to Mode.INSTRUCTOR,
        )
        assertEquals(expected, IntentPolicy.INTENTS.mapValues { it.value.mode })
    }

    @Test
    fun `rider mode has no instructor intent and instructor mode has no rider intent`() {
        val rider = IntentPolicy.of(Mode.RIDER)
        val instructor = IntentPolicy.of(Mode.INSTRUCTOR)
        assertEquals(setOf("instructorWay", "askInstructorMode"), rider)
        assertEquals(setOf("askRiderMode"), instructor)
        assertTrue(rider.intersect(instructor).isEmpty())
        assertEquals(IntentPolicy.INTENTS.keys, rider + instructor)
    }

    @Test
    fun `each intent runs only from its own mode's plugin while the app is in that mode`() {
        for ((name, spec) in IntentPolicy.INTENTS) {
            val mode = spec.mode
            assertNull(name, IntentPolicy.check(mode, mode, name, emptyMap()))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(mode, other.getValue(mode), name, emptyMap()))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(other.getValue(mode), mode, name, emptyMap()))
            assertEquals(name, Refusal.SWITCHING, IntentPolicy.check(null, mode, name, emptyMap()))
        }
    }

    @Test
    fun `each intent rejects an unexpected argument`() {
        val extras = listOf("mode" to "instructor", "unlock" to true, "x" to null, "" to 1, "__proto__" to "{}")
        for ((name, spec) in IntentPolicy.INTENTS) {
            for (extra in extras) {
                assertEquals("$name $extra", Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(spec.mode, spec.mode, name, mapOf(extra)))
            }
        }
    }

    @Test
    fun `instructorWay rejects an unexpected argument`() = rejectsExtra("instructorWay")

    @Test
    fun `askInstructorMode rejects an unexpected argument`() = rejectsExtra("askInstructorMode")

    @Test
    fun `askRiderMode rejects an unexpected argument`() = rejectsExtra("askRiderMode")

    private fun rejectsExtra(name: String) {
        val mode = IntentPolicy.INTENTS.getValue(name).mode
        assertEquals(Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(mode, mode, name, mapOf("mode" to "instructor")))
    }

    @Test
    fun `an unknown name is refused in either mode`() {
        for (name in listOf("", "setMode", "unlock", "askinstructormode", "askRiderMode ")) {
            for (mode in Mode.entries) assertEquals(Refusal.UNKNOWN, IntentPolicy.check(mode, mode, name, emptyMap()))
        }
    }

    @Test
    fun `typed arguments are checked by name and type`() {
        val intents = mapOf("join" to Spec(Mode.RIDER, mapOf("code" to Arg.STRING, "again" to Arg.BOOLEAN, "n" to Arg.NUMBER)))
        val good = mapOf<String, Any?>("code" to "AB12", "again" to false, "n" to 3)
        fun check(args: Map<String, Any?>) = IntentPolicy.check(Mode.RIDER, Mode.RIDER, "join", args, intents)
        assertNull(check(good))
        assertEquals(Refusal.MISSING_ARGUMENT, check(good - "code"))
        assertEquals(Refusal.UNEXPECTED_ARGUMENT, check(good + ("extra" to 1)))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("code" to 12)))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("again" to "true")))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("n" to "3")))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("code" to null)))
        assertEquals(setOf("join"), IntentPolicy.of(Mode.RIDER, intents))
    }
}
