package org.classbeat.player.policy

// The named intents the web view may call, split by mode (ADR 0011 section 3, issue #630). Pure:
// no Android import. Each intent belongs to one mode and takes a fixed set of arguments; a call
// from the other mode, while the app is between modes, or with any argument the intent does not
// name is refused before native code acts on it. Later issues add their intents here, such as the
// instructor's live session.

object IntentPolicy {
    /** The type an argument must have, as the bridge hands it over (org.json values). */
    enum class Arg { STRING, BOOLEAN, NUMBER }

    data class Spec(val mode: Mode, val args: Map<String, Arg>)

    /** Every intent, by the method name its mode's plugin carries. */
    val INTENTS: Map<String, Spec> = mapOf(
        // Rider mode: which way "Switch to instructor mode" goes, for the strip's lead line.
        "instructorWay" to Spec(Mode.RIDER, emptyMap()),
        // Rider mode: "Switch to instructor mode" pressed. Native code decides what follows.
        "askInstructorMode" to Spec(Mode.RIDER, emptyMap()),
        // Rider mode (#633): join with the class code and a nickname, open the live link, wait for
        // what comes in (one call at a time) and leave. Native code holds the rider token and sends
        // `hello` itself; the page never sends a frame and never sees the token.
        "join" to Spec(Mode.RIDER, mapOf("session" to Arg.STRING, "nickname" to Arg.STRING)),
        "open" to Spec(Mode.RIDER, emptyMap()),
        "receive" to Spec(Mode.RIDER, emptyMap()),
        "leave" to Spec(Mode.RIDER, emptyMap()),
        // Instructor mode: "Switch to rider mode" pressed. Native code asks the question.
        "askRiderMode" to Spec(Mode.INSTRUCTOR, emptyMap()),
        // Instructor mode (#631): the cached classes, a sync now, one class by its id, unpairing
        // this phone, and pairing again once the pairing expired. Native code picks each backend
        // call and adds the device token; the page names no path, address or token.
        "listClasses" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "syncNow" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "getClass" to Spec(Mode.INSTRUCTOR, mapOf("id" to Arg.STRING)),
        "unpair" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "pairAgain" to Spec(Mode.INSTRUCTOR, emptyMap()),
        // Instructor mode (#632): following the music app. Notification access is asked for only
        // here (openFollowSetting is the only way to the setting), so never in rider mode. None
        // takes an argument: the page names no app, session or package.
        "followAccess" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "openFollowSetting" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "follow" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "unfollow" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "reading" to Spec(Mode.INSTRUCTOR, emptyMap()),
        // Instructor mode (#857): play, pause and next, pressed by the instructor while following,
        // and only these three. Native code sends each through the music app's own media session
        // (ADR 0011 section 6). None takes an argument: the page names no command, app or position.
        "sendPlay" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "sendPause" to Spec(Mode.INSTRUCTOR, emptyMap()),
        "sendNext" to Spec(Mode.INSTRUCTOR, emptyMap()),
    )

    /** The intents [mode] has, and only those. */
    fun of(mode: Mode, intents: Map<String, Spec> = INTENTS): Set<String> =
        intents.filterValues { it.mode == mode }.keys

    /** Why a call was refused. The page sees only a fixed word, never the arguments. */
    enum class Refusal { UNKNOWN, OTHER_MODE, SWITCHING, UNEXPECTED_ARGUMENT, MISSING_ARGUMENT, WRONG_TYPE }

    /**
     * Checks a call to [name] with [args] from [plugin]'s mode while the app is in [current] (null
     * while switching). Null means the call may run; anything else is why it may not.
     */
    fun check(
        current: Mode?,
        plugin: Mode,
        name: String,
        args: Map<String, Any?>,
        intents: Map<String, Spec> = INTENTS,
    ): Refusal? {
        val spec = intents[name] ?: return Refusal.UNKNOWN
        if (spec.mode != plugin) return Refusal.OTHER_MODE
        if (current == null) return Refusal.SWITCHING
        if (current != plugin) return Refusal.OTHER_MODE
        if (args.keys.any { it !in spec.args }) return Refusal.UNEXPECTED_ARGUMENT
        for ((key, type) in spec.args) {
            if (key !in args) return Refusal.MISSING_ARGUMENT
            if (!fits(args[key], type)) return Refusal.WRONG_TYPE
        }
        return null
    }

    private fun fits(value: Any?, type: Arg): Boolean = when (type) {
        Arg.STRING -> value is String
        Arg.BOOLEAN -> value is Boolean
        Arg.NUMBER -> value is Number
    }
}
