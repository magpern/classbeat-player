package org.classbeat.player.mode

import androidx.activity.OnBackPressedCallback
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.policy.Mode
import org.classbeat.player.rider.RiderReply
import org.classbeat.player.rider.RiderSession

/**
 * Rider mode's live intents on the bridge (issue #633): each call goes to [RiderSession], which
 * keeps the rider token to itself. An answer or event that comes after rider mode closed is refused,
 * never sent to the next mode's page. While a rider is joined, the hardware Back asks the page
 * "Leave the class?" instead of leaving the page.
 */
class RiderBridge(private val session: RiderSession, private val current: () -> Mode?) {
    val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = session.backPressed()
    }

    init {
        session.changed = { back.isEnabled = session.joined }
    }

    /** Both were checked as strings by IntentPolicy; RiderSession checks their form. */
    fun join(call: PluginCall) = session.join(call.getString("session") ?: "", call.getString("nickname") ?: "", reply(call))

    fun open(call: PluginCall) = session.open(reply(call))

    fun receive(call: PluginCall) = session.receive(reply(call))

    fun leave(call: PluginCall) = session.leave(reply(call))

    private fun reply(call: PluginCall): RiderReply = { data ->
        val answer = if (data == null || current() != Mode.RIDER) null else runCatching { JSObject(CanonicalJson.write(data)) }.getOrNull()
        if (answer == null) call.reject(ModePlugin.REFUSED) else call.resolve(answer)
    }
}
