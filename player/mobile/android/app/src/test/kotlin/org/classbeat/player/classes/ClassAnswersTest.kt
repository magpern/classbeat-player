package org.classbeat.player.classes

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.classes.ClassAnswers.FetchResult
import org.classbeat.player.classes.ClassAnswers.ListResult
import org.classbeat.player.classes.ClassAnswers.Refusal
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeClasses.change
import org.classbeat.player.fake.FakeClasses.classAnswer
import org.classbeat.player.fake.FakeClasses.doc
import org.classbeat.player.fake.FakeClasses.hash
import org.classbeat.player.fake.FakeClasses.id
import org.classbeat.player.fake.FakeClasses.page
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassAnswersTest {
    private val unexpected = ListResult.Refused(Refusal.UNEXPECTED)

    @Test
    fun `a page is read in order, with removals carrying no hash`() {
        val r = ClassAnswers.parseChanges(page(9, false, change(id(1), 3, doc("A")), change(id(2), 5)), 2) as ListResult.Page
        assertEquals(listOf(false, true), r.changes.map { it.removed })
        assertEquals(9L, r.cursor)
    }

    @Test
    fun `a page that goes back, repeats, overshoots or stalls is unexpected`() {
        assertEquals(unexpected, ClassAnswers.parseChanges(page(9, false, change(id(1), 2, doc("A"))), 2))
        assertEquals(unexpected, ClassAnswers.parseChanges(page(9, false, change(id(1), 3, doc("A")), change(id(1), 4, doc("A"))), 0))
        assertEquals(unexpected, ClassAnswers.parseChanges(page(3, false, change(id(1), 4, doc("A"))), 0))
        assertEquals(unexpected, ClassAnswers.parseChanges(page(2, true), 2))
        val extra = (page(9, false).body as Map<*, *>) + ("x" to 1.0)
        assertEquals(unexpected, ClassAnswers.parseChanges(FakeBackend.ok(extra), 0))
    }

    @Test
    fun `the refusals are read from the status and the code`() {
        assertEquals(ListResult.Refused(Refusal.OFFLINE), ClassAnswers.parseChanges(HttpAnswer.Unreachable, 0))
        assertEquals(ListResult.Refused(Refusal.RETRY), ClassAnswers.parseChanges(FakeBackend.status(429), 0))
        assertEquals(ListResult.Refused(Refusal.GONE), ClassAnswers.parseChanges(FakeBackend.error(401, "token_unknown"), 0))
        assertEquals(ListResult.Refused(Refusal.EXPIRED), ClassAnswers.parseChanges(FakeBackend.error(401, "token_expired"), 0))
        assertEquals(unexpected, ClassAnswers.parseChanges(FakeBackend.error(401, "other"), 0))
        assertEquals(ListResult.Resync, ClassAnswers.parseChanges(HttpAnswer.Http(409, mapOf("error" to "resync_required", "cursor" to 0.0), null), 7))
    }

    @Test
    fun `a class is kept only with its own content hash, as canonical text`() {
        val d = doc("A")
        val ok = ClassAnswers.parseClass(classAnswer(id(1), d), id(1)) as FetchResult.Class
        assertEquals(hash(d), ok.hash)
        assertEquals(CanonicalJson.write(d), ok.text)
        assertEquals(FetchResult.Unusable, ClassAnswers.parseClass(classAnswer(id(1), d, hash(doc("B"))), id(1)))
        assertEquals(FetchResult.Unusable, ClassAnswers.parseClass(classAnswer(id(2), d), id(1)))
        assertEquals(FetchResult.NotFound, ClassAnswers.parseClass(FakeBackend.error(404, "not_found"), id(1)))
        assertTrue(ClassAnswers.parseClass(FakeBackend.error(401, "token_revoked"), id(1)) == FetchResult.Refused(Refusal.GONE))
    }
}
