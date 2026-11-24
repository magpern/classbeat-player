package org.classbeat.player.classes

import org.classbeat.player.backend.Calls
import org.classbeat.player.backend.Json
import org.classbeat.player.pairing.PairingService
import org.classbeat.player.pairing.PairingView
import org.classbeat.player.policy.AnswerPolicy
import kotlin.math.roundToLong

/** An intent's answer for the page, or null for the one refused word. */
typealias Reply = (Map<String, Any?>?) -> Unit

/**
 * Instructor mode's class intents (ADR 0011 §3 and §4, issue #631): the list, one class and a sync.
 * The page names no path, address or token: each intent is one fixed native call, the device token
 * is added in native code (ClassSync), and every answer passes [AnswerPolicy] before it is sent. A
 * class reaches the page only from the cache, whose documents were checked against their content
 * hash. Pure: the pairing, the cache and the sync are given. Main thread only.
 */
class InstructorIntents(
    private val pairing: PairingService,
    private val cache: ClassCache,
    private val sync: ClassSync,
) {
    /** The last sync's outcome in the class list's words (docs/design/class-list.md, "Status"). */
    private var status = "syncing"

    /** `{classes: [{id, title, minutes, songs}], status}`: every cached class with the list's shape. */
    fun listClasses(reply: Reply) {
        val rows = try {
            cache.held().keys.mapNotNull { id -> cache.document(id)?.let { ClassRows.row(id, Json.tryParse(it).getOrNull()) } }
        } catch (e: Exception) {
            return answer(reply, mapOf("classes" to emptyList<Any>(), "status" to "unavailable"))
        }
        val list = ClassRows.sorted(rows).map {
            mapOf("id" to it.id, "title" to it.title, "minutes" to (it.lengthMs / 60_000).roundToLong(), "songs" to it.songs)
        }
        answer(reply, mapOf("classes" to list, "status" to shownStatus()))
    }

    /** Syncs now, then answers as [listClasses]. A sync already running is joined, not doubled. */
    fun syncNow(reply: Reply) {
        sync.run { outcome ->
            status = word(outcome)
            listClasses(reply)
        }
    }

    /** `{document}` for a cached class, or `{error: "not_found"}`. */
    fun getClass(id: String, reply: Reply) {
        if (!Calls.isClassId(id)) return reply(null)
        val text = try {
            cache.document(id)
        } catch (e: Exception) {
            null
        }
        val document = text?.let { Json.tryParse(it).getOrNull() } ?: return answer(reply, mapOf("error" to "not_found"))
        answer(reply, mapOf("document" to document))
    }

    /** Unpairs this phone: the token and the cache go, and instructor mode closes (the edge's forgotten). */
    fun unpair() = pairing.unpair()

    private fun shownStatus(): String {
        val view = pairing.view()
        return if (view is PairingView.Paired && view.expired) "expired" else status
    }

    private fun answer(reply: Reply, data: Map<String, Any?>) {
        reply(if (AnswerPolicy.mayAnswer(data, pairing.secrets())) data else null)
    }

    private fun word(outcome: ClassSync.Outcome): String = when (outcome) {
        ClassSync.Outcome.UP_TO_DATE -> "synced"
        ClassSync.Outcome.OFFLINE -> "offline"
        ClassSync.Outcome.RETRY, ClassSync.Outcome.UNEXPECTED -> "waiting"
        ClassSync.Outcome.EXPIRED, ClassSync.Outcome.NOT_PAIRED -> "expired"
        ClassSync.Outcome.GONE -> "unpaired"
        ClassSync.Outcome.STORAGE -> "unavailable"
    }
}
