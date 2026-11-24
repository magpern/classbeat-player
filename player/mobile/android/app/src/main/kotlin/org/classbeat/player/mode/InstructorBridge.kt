package org.classbeat.player.mode

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.classes.InstructorIntents
import org.classbeat.player.classes.Reply
import org.classbeat.player.policy.Mode

/**
 * Instructor mode's class intents on the bridge (issue #631): each call goes to [InstructorIntents],
 * whose answers have already passed the answer guard. An answer that comes after instructor mode
 * closed (a sync that ended in a switch) is refused, never sent to the next mode's page.
 */
class InstructorBridge(private val intents: InstructorIntents, private val current: () -> Mode?) {
    fun listClasses(call: PluginCall) = intents.listClasses(reply(call))

    fun syncNow(call: PluginCall) = intents.syncNow(reply(call))

    /** The id was checked as a string by IntentPolicy; InstructorIntents checks its form. */
    fun getClass(call: PluginCall) = intents.getClass(call.getString("id") ?: "", reply(call))

    /** Answered first: unpairing closes instructor mode, and its page with it. */
    fun unpair(call: PluginCall) {
        call.resolve(JSObject().put("result", "unpaired"))
        intents.unpair()
    }

    private fun reply(call: PluginCall): Reply = { data ->
        val answer = if (data == null || current() != Mode.INSTRUCTOR) null else runCatching { JSObject(CanonicalJson.write(data)) }.getOrNull()
        if (answer == null) call.reject(ModePlugin.REFUSED) else call.resolve(answer)
    }
}
