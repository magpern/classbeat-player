package org.classbeat.spike

/** The two clocks every line carries: monotonic (`elapsedRealtime`) and wall. */
data class Stamp(val monoMs: Long, val wallMs: Long)

/** A small JSON writer (no library): strings, numbers, booleans, null, lists and maps. */
fun jsonValue(v: Any?): String = when (v) {
    null -> "null"
    is String -> jsonString(v)
    is Boolean -> v.toString()
    is Int, is Long -> v.toString()
    is Double -> if (v.isNaN() || v.isInfinite()) "null" else v.toString()
    is Map<*, *> -> v.entries.joinToString(",", "{", "}") { jsonString(it.key.toString()) + ":" + jsonValue(it.value) }
    is List<*> -> v.joinToString(",", "[", "]") { jsonValue(it) }
    else -> throw IllegalArgumentException("not a JSON value: ${v::class.java.name}")
}

fun jsonString(s: String): String {
    val sb = StringBuilder("\"")
    for (c in s) {
        when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c < ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
    }
    return sb.append('"').toString()
}

private fun head(t: String, s: Stamp) = "{\"t\":${jsonString(t)},\"monoMs\":${s.monoMs},\"wallMs\":${s.wallMs}"

/** Same field order as spike 1's `Reading` JSON. */
fun readingJson(r: Reading?): String = if (r == null) "null" else jsonValue(
    linkedMapOf(
        "trackId" to r.trackId, "title" to r.title, "artist" to r.artist, "positionMs" to r.positionMs,
        "durationMs" to r.durationMs, "state" to r.state.json, "readAtMs" to r.readAtMs,
        "polledAtMs" to r.polledAtMs, "source" to r.source, "app" to r.app,
    ),
)

fun metaLine(s: Stamp, info: Map<String, Any?>): String =
    head("meta", s) + info.entries.joinToString("") { ",${jsonString(it.key)}:${jsonValue(it.value)}" } + "}"

/** The `decision` of spike 1's reading line is left out: the follower runs offline, in the replay. */
fun readingLine(s: Stamp, r: Reading?): String = head("reading", s) + ",\"reading\":${readingJson(r)}}"

fun readerErrorLine(s: Stamp, text: String): String = head("reader_error", s) + ",\"text\":${jsonString(text)}}"

/** A beat tap (`b`) or mark (`m`). The class time is null: the replay works it out. */
fun markerLine(s: Stamp, key: String): String = head("marker", s) + ",\"key\":${jsonString(key)},\"classTimeMs\":null}"

/** `undo` or `relink`, applied by the replay at this time. */
fun controlLine(s: Stamp, key: String): String = head("control", s) + ",\"key\":${jsonString(key)},\"decision\":null}"

/** One second of the scene run: `fps` from the page's frame callbacks, `sceneFps` from the demo's own log. */
fun fpsLine(s: Stamp, second: Int, frames: Long, fps: Double, sceneFps: Double?): String =
    head("fps", s) + ",\"second\":$second,\"frames\":$frames,\"fps\":${jsonValue(round1(fps))},\"sceneFps\":${jsonValue(sceneFps)}}"

fun fpsSummaryLine(s: Stamp, sum: FpsSummary): String = head("fps_summary", s) +
    sum.asMap().entries.joinToString("") { ",${jsonString(it.key)}:${jsonValue(it.value)}" } + "}"

fun round1(x: Double): Double = Math.round(x * 10.0) / 10.0
