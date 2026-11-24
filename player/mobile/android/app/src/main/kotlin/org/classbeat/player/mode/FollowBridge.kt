package org.classbeat.player.mode

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.follow.Follower
import org.classbeat.player.policy.AnswerPolicy
import org.classbeat.player.policy.Mode

/**
 * Instructor mode's follow intents on the bridge (issue #632). IntentPolicy has already checked
 * the call is instructor mode's; each answer is checked again here against the mode and passes
 * [AnswerPolicy], as the class answers do, before it is sent.
 */
class FollowBridge(
    private val follower: Follower,
    private val secrets: () -> List<String>,
    private val current: () -> Mode?,
) {
    fun followAccess(call: PluginCall) = answer(call) { follower.followAccess() }

    fun openFollowSetting(call: PluginCall) = answer(call) { follower.openFollowSetting() }

    fun follow(call: PluginCall) = answer(call) { follower.follow() }

    fun unfollow(call: PluginCall) = answer(call) { follower.unfollow() }

    fun reading(call: PluginCall) = answer(call) { follower.reading() }

    private fun answer(call: PluginCall, run: () -> Map<String, Any?>) {
        if (current() != Mode.INSTRUCTOR) return call.reject(ModePlugin.REFUSED)
        val data = run()
        val answer = if (AnswerPolicy.mayAnswer(data, secrets())) runCatching { JSObject(CanonicalJson.write(data)) }.getOrNull() else null
        if (answer == null) call.reject(ModePlugin.REFUSED) else call.resolve(answer)
    }
}
