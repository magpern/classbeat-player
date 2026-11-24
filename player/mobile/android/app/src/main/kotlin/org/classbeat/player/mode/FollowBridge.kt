package org.classbeat.player.mode

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.follow.Follower
import org.classbeat.player.policy.AnswerPolicy
import org.classbeat.player.policy.Mode

/** Where a follow answer goes: its canonical JSON, or null for the one refused word. */
typealias FollowSend = (String?) -> Unit

/**
 * Instructor mode's follow intents on the bridge (issue #632). IntentPolicy has already checked
 * the call is instructor mode's; each answer is checked again here against the mode and passes
 * [AnswerPolicy], as the class answers do, before it is sent. The [FollowSend] forms decide; the
 * [PluginCall] forms only carry the answer to the page.
 */
class FollowBridge(
    private val follower: Follower,
    private val secrets: () -> List<String>,
    private val current: () -> Mode?,
) {
    fun followAccess(call: PluginCall) = followAccess(send(call))

    fun openFollowSetting(call: PluginCall) = openFollowSetting(send(call))

    fun follow(call: PluginCall) = follow(send(call))

    fun unfollow(call: PluginCall) = unfollow(send(call))

    fun reading(call: PluginCall) = reading(send(call))

    fun followAccess(send: FollowSend) = answer(send) { follower.followAccess() }

    fun openFollowSetting(send: FollowSend) = answer(send) { follower.openFollowSetting() }

    fun follow(send: FollowSend) = answer(send) { follower.follow() }

    fun unfollow(send: FollowSend) = answer(send) { follower.unfollow() }

    fun reading(send: FollowSend) = answer(send) { follower.reading() }

    private fun answer(send: FollowSend, run: () -> Map<String, Any?>) {
        // Outside instructor mode the follower is not even asked.
        if (current() != Mode.INSTRUCTOR) return send(null)
        val data = run()
        send(if (AnswerPolicy.mayAnswer(data, secrets())) runCatching { CanonicalJson.write(data) }.getOrNull() else null)
    }

    private fun send(call: PluginCall): FollowSend = { json ->
        val answer = json?.let { runCatching { JSObject(it) }.getOrNull() }
        if (answer == null) call.reject(ModePlugin.REFUSED) else call.resolve(answer)
    }
}
