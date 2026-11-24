package org.classbeat.player.mode

/** One line of a native screen (ModeScreens), as words only. Pure: the screens' models build these. */
sealed class ScreenLine {
    /** The mode tag: "Rider mode" or "Instructor mode". */
    data class Tag(val words: String) : ScreenLine()

    data class Title(val words: String) : ScreenLine()

    data class Text(val words: String) : ScreenLine()

    /** A grey note. */
    data class Note(val words: String) : ScreenLine()

    /** The still, hollow working marker and its words. */
    data class Working(val words: String) : ScreenLine()

    /** The pairing code on its raised panel labelled "Code": the largest text on the screen. */
    data class Code(val code: String) : ScreenLine()

    /** A numbered step. */
    data class Step(val number: Int, val words: String) : ScreenLine()

    /** A white plate: what happened, then what to do. */
    data class Plate(val head: String, val body: String) : ScreenLine()
}
