package org.classbeat.player.mode

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.classbeat.player.policy.IntentPolicy
import org.classbeat.player.policy.Mode

/**
 * The page's only way into native code (ADR 0011 section 3, issue #630): one plugin per mode, each
 * with its own mode's named intents (IntentPolicy) and nothing else. Only the current mode's plugin
 * is on the bridge (PluginPolicy.expose); each call is checked again against the mode the holder is
 * in and against the intent's arguments before anything runs. A refused call gets one fixed word.
 */
abstract class ModePlugin(private val mode: Mode) : Plugin() {
    /** The activity's controller; null only if the plugin outlived it. */
    abstract fun controller(): ModeController?

    protected fun handle(call: PluginCall, run: (ModeController, PluginCall) -> Unit) {
        val name = call.methodName
        val args = argsOf(call)
        // Capacitor calls plugins on its own thread; the holder lives on the main one.
        activity.runOnUiThread {
            val controller = controller()
            val refusal = if (controller == null) IntentPolicy.Refusal.SWITCHING else IntentPolicy.check(controller.current, mode, name, args)
            if (refusal != null || controller == null) call.reject(REFUSED) else run(controller, call)
        }
    }

    // Capacitor's Plugin carries five methods of its own marked @PluginMethod, which the page could
    // call on any plugin. Overridden without the mark, they are no longer on the bridge (Capacitor
    // reads the mark from Class.getMethods, which returns these overrides); each refuses anyway.
    override fun addListener(call: PluginCall) = call.reject(REFUSED)

    override fun removeListener(call: PluginCall) = call.reject(REFUSED)

    override fun removeAllListeners(call: PluginCall) = call.reject(REFUSED)

    override fun checkPermissions(pluginCall: PluginCall) = pluginCall.reject(REFUSED)

    override fun requestPermissions(call: PluginCall) = call.reject(REFUSED)

    private fun argsOf(call: PluginCall): Map<String, Any?> {
        val data = call.data
        return data.keys().asSequence().associateWith { data.opt(it) }
    }

    companion object {
        const val REFUSED = "refused"
    }
}

@CapacitorPlugin(name = "RiderMode")
class RiderModePlugin : ModePlugin(Mode.RIDER) {
    override fun controller() = (activity as? ModeHost)?.modes

    @PluginMethod
    fun instructorWay(call: PluginCall) = handle(call) { c, k -> c.instructorWay(k) }

    @PluginMethod
    fun askInstructorMode(call: PluginCall) = handle(call) { c, k -> c.askInstructorMode(k) }

    @PluginMethod
    fun join(call: PluginCall) = handle(call) { c, k -> c.rider.join(k) }

    @PluginMethod
    fun open(call: PluginCall) = handle(call) { c, k -> c.rider.open(k) }

    @PluginMethod
    fun receive(call: PluginCall) = handle(call) { c, k -> c.rider.receive(k) }

    @PluginMethod
    fun leave(call: PluginCall) = handle(call) { c, k -> c.rider.leave(k) }
}

@CapacitorPlugin(name = "InstructorMode")
class InstructorModePlugin : ModePlugin(Mode.INSTRUCTOR) {
    override fun controller() = (activity as? ModeHost)?.modes

    @PluginMethod
    fun askRiderMode(call: PluginCall) = handle(call) { c, k -> c.askRiderMode(k) }

    @PluginMethod
    fun listClasses(call: PluginCall) = handle(call) { c, k -> c.instructor.listClasses(k) }

    @PluginMethod
    fun syncNow(call: PluginCall) = handle(call) { c, k -> c.instructor.syncNow(k) }

    @PluginMethod
    fun getClass(call: PluginCall) = handle(call) { c, k -> c.instructor.getClass(k) }

    @PluginMethod
    fun unpair(call: PluginCall) = handle(call) { c, k -> c.unpair(k) }

    @PluginMethod
    fun pairAgain(call: PluginCall) = handle(call) { c, k -> c.pairAgain(k) }

    @PluginMethod
    fun followAccess(call: PluginCall) = handle(call) { c, k -> c.follow.followAccess(k) }

    @PluginMethod
    fun openFollowSetting(call: PluginCall) = handle(call) { c, k -> c.follow.openFollowSetting(k) }

    @PluginMethod
    fun follow(call: PluginCall) = handle(call) { c, k -> c.follow.follow(k) }

    @PluginMethod
    fun unfollow(call: PluginCall) = handle(call) { c, k -> c.follow.unfollow(k) }

    @PluginMethod
    fun reading(call: PluginCall) = handle(call) { c, k -> c.follow.reading(k) }

    @PluginMethod
    fun sendPlay(call: PluginCall) = handle(call) { c, k -> c.follow.sendPlay(k) }

    @PluginMethod
    fun sendPause(call: PluginCall) = handle(call) { c, k -> c.follow.sendPause(k) }

    @PluginMethod
    fun sendNext(call: PluginCall) = handle(call) { c, k -> c.follow.sendNext(k) }
}

/** The activity that holds the mode controller. */
interface ModeHost {
    val modes: ModeController?
}
