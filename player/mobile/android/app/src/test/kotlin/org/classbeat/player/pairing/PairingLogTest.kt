package org.classbeat.player.pairing

import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.backend.Method
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakePorts
import org.classbeat.player.fake.FakeStore
import org.classbeat.player.fake.Secrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.PrintStream
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger

/**
 * No secret of a pairing (the pairing code, the device code, a token) is written to the log (#964).
 * The pairing path holds no log call at all, and a whole pairing run writes nothing that carries one
 * to standard output, standard error or java.util.logging. In these JVM tests android.util.Log is a
 * stub that throws (unitTests.isReturnDefaultValues = false), so a Log call on the run fails it too.
 */
class PairingLogTest {
    private val userCode = "BCDF-GHJK"
    private val secrets = listOf(Secrets.token(), Secrets.token('C'), Secrets.deviceCode(), userCode)

    /** Every source the pairing runs through: its state, store and ports, the screen, and the calls it makes. */
    private fun pairingSources(): List<File> {
        val main = File("src/main/kotlin/org/classbeat/player")
        val files = File(main, "pairing").listFiles().orEmpty().toList() +
            File(main, "backend").listFiles().orEmpty().toList() +
            File(main, "mode").listFiles { f -> f.name.startsWith("Pairing") || f.name == "UnpairQuestion.kt" }.orEmpty().toList()
        return files.filter { it.name.endsWith(".kt") }.sortedBy { it.path }
    }

    /** Any way to write a line to the log or the console, from Kotlin or Java. */
    private val logCall = Regex(
        """\bandroid\.util\.Log\b|\bLog\.(v|d|i|w|e|wtf|println)\s*\(|\bprintln\s*\(|\bprint\s*\(|\bprintStackTrace\s*\(""" +
            """|\bSystem\.(out|err)\b|\bjava\.util\.logging\b|\bLogger\b|\bTimber\b|\borg\.slf4j\b""",
    )

    @Test
    fun `the pairing path holds no log call`() {
        val files = pairingSources()
        // The guard reads the real files: an empty or moved directory would make it pass on nothing.
        val names = files.map { it.name }
        for (known in listOf("PairingService.kt", "PairingMachine.kt", "KeystoreSecretStore.kt", "BackendTransport.kt", "PairingUi.kt", "PairingSeams.kt")) {
            assertTrue("$known is read", known in names)
        }
        val found = files.flatMap { f ->
            f.readLines().withIndex().filter { logCall.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}: ${it.value.trim()}" }
        }
        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `a whole pairing run writes no secret to the log`() {
        val written = capture {
            // A first pairing, its unpairing, then an expired pairing paired again whose new token
            // cannot be kept: every secret passes through the service and the screen model.
            val backend = FakeBackend()
            val ports = FakePorts()
            val first = PairingService(ORIGIN, false, "1.0.0", backend, FakeStore(), ports)
            backend.route = { r ->
                when (r.path) {
                    "/api/pairing/start" -> FakeBackend.started()
                    "/api/pairing/token" -> FakeBackend.token()
                    else -> FakeBackend.device()
                }
            }
            first.changed = { PairingScreenModel.screen(first.view(), ports.now, true, false, true) }
            first.load()
            first.begin()
            backend.flush()
            ports.fireNext()
            backend.flush()
            assertTrue(first.view() is PairingView.Paired)
            first.unpair()
            backend.flush()

            val store = FakeStore(saves = false, text = PairingRecord(ORIGIN, Secrets.token(), "coach@example.test").text())
            backend.expired = setOf(Secrets.token())
            backend.route = { r ->
                when (r.path) {
                    "/api/pairing/start" -> FakeBackend.started()
                    "/api/pairing/token" -> FakeBackend.token(Secrets.token('C'))
                    else -> if (r.method == Method.DELETE) HttpAnswer.Unreachable else FakeBackend.TOKEN_EXPIRED
                }
            }
            val again = PairingService(ORIGIN, false, "1.0.0", backend, store, ports)
            again.changed = { PairingScreenModel.screen(again.view(), ports.now, true, false, true) }
            again.load()
            backend.flush()
            again.begin()
            backend.flush()
            ports.fireNext()
            backend.flush()
            assertEquals(PairingView.Unpaired(PairingMachine.Notice.SAVE_FAILED), again.view())
            // Every secret was in play: both tokens were sent, and the code was shown.
            assertTrue(backend.sent.any { it.token == Secrets.token() } && backend.sent.any { it.token == Secrets.token('C') })
        }
        for (secret in secrets) assertTrue("a secret was written to the log", !written.contains(secret))
    }

    /** Runs [run] with standard output, standard error and java.util.logging captured; returns all they were given. */
    private fun capture(run: () -> Unit): String {
        val bytes = ByteArrayOutputStream()
        val sink = PrintStream(bytes, true, Charsets.UTF_8)
        val records = StringBuilder()
        val handler = object : Handler() {
            override fun publish(record: LogRecord) {
                records.append(record.message).append(' ').append(record.parameters?.joinToString(" ")).append(' ')
                    .append(record.thrown?.toString()).append('\n')
            }

            override fun flush() {}

            override fun close() {}
        }
        val root = Logger.getLogger("")
        val level = root.level
        val out = System.out
        val err = System.err
        System.setOut(sink)
        System.setErr(sink)
        root.level = Level.ALL
        root.addHandler(handler)
        try {
            run()
        } finally {
            root.removeHandler(handler)
            root.level = level
            System.setOut(out)
            System.setErr(err)
        }
        return bytes.toString(Charsets.UTF_8) + records
    }
}
