package org.classbeat.player.fake

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.nio.file.Files
import java.security.KeyStore
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

/**
 * A fake backend on the loopback address only, over TLS with a certificate made for this run by the
 * JDK's keytool (never a committed key). It answers each request from [answer] and records what it
 * got, so a test sees exactly what the transport sent. Nothing leaves the machine.
 */
class LoopbackHttps(private val answer: (Received) -> Reply) : AutoCloseable {
    class Received(val method: String, val target: String, val headers: Map<String, String>, val body: String)

    /**
     * What to send back. [stallMs] waits that long after the headers; [dripMs] sends the body one
     * byte at a time, that long apart; without [length] the body's end is the connection's.
     */
    class Reply(
        val status: Int,
        val body: ByteArray = ByteArray(0),
        val headers: Map<String, String> = emptyMap(),
        val stallMs: Long = 0,
        val dripMs: Long = 0,
        val length: Boolean = true,
    )

    private val dir: File = Files.createTempDirectory("loopback-tls").toFile()
    private val keys: KeyStore = makeKeys(dir)
    private val server = SSLContext.getInstance("TLS").run {
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(keys, PASS)
        init(kmf.keyManagers, null, null)
        serverSocketFactory.createServerSocket(0, 16, InetAddress.getLoopbackAddress())
    }
    val received: MutableList<Received> = Collections.synchronizedList(mutableListOf())
    val connections = AtomicInteger()
    val origin = "https://127.0.0.1:${server.localPort}"

    /** A client factory that trusts this run's certificate, and only it. */
    val trusting: SSLSocketFactory = SSLContext.getInstance("TLS").run {
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        val only = KeyStore.getInstance("PKCS12").apply {
            load(null, null)
            setCertificateEntry("loopback", keys.getCertificate("loopback"))
        }
        tmf.init(only)
        init(null, tmf.trustManagers, null)
        socketFactory
    }

    private val acceptor = Thread {
        while (!server.isClosed) {
            val s = try { server.accept() } catch (e: Exception) { break }
            connections.incrementAndGet()
            Thread { s.use { serve(it::getInputStream, it::getOutputStream) } }.apply { isDaemon = true }.start()
        }
    }.apply { isDaemon = true; start() }

    private fun serve(rawIn: () -> InputStream, rawOut: () -> OutputStream) {
        try {
            val input = BufferedInputStream(rawIn())
            val out = rawOut()
            val head = line(input).split(" ")
            val headers = linkedMapOf<String, String>()
            while (true) {
                val l = line(input)
                if (l.isEmpty()) break
                val i = l.indexOf(':')
                headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
            }
            val length = headers["content-length"]?.toInt() ?: 0
            val body = String(input.readNBytes(length), Charsets.UTF_8)
            val r = Received(head[0], head[1], headers, body)
            received += r
            val reply = answer(r)
            val text = StringBuilder("HTTP/1.1 ${reply.status} X\r\nConnection: close\r\n")
            if (reply.length) text.append("Content-Length: ${reply.body.size}\r\n")
            for ((k, v) in reply.headers) text.append("$k: $v\r\n")
            out.write(text.append("\r\n").toString().toByteArray(Charsets.ISO_8859_1))
            out.flush()
            if (reply.stallMs > 0) Thread.sleep(reply.stallMs)
            if (reply.dripMs == 0L) out.write(reply.body)
            for (b in if (reply.dripMs > 0) reply.body else ByteArray(0)) {
                out.write(b.toInt())
                out.flush()
                Thread.sleep(reply.dripMs)
            }
            out.flush()
        } catch (e: Exception) {
            // The client went away (a timeout or a refused answer): nothing to do.
        }
    }

    private fun line(input: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = input.read()
            if (c < 0 || c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
        }
        return b.toString(Charsets.ISO_8859_1)
    }

    override fun close() {
        server.close()
        acceptor.join(2000)
        dir.deleteRecursively()
    }

    private companion object {
        val PASS = "loopback-test-only".toCharArray()

        fun makeKeys(dir: File): KeyStore {
            val file = File(dir, "keys.p12")
            val keytool = File(System.getProperty("java.home"), "bin/keytool").path
            val p = ProcessBuilder(
                keytool, "-genkeypair", "-alias", "loopback", "-keyalg", "EC", "-groupname", "secp256r1",
                "-dname", "CN=127.0.0.1", "-ext", "SAN=ip:127.0.0.1", "-validity", "1",
                "-storetype", "PKCS12", "-keystore", file.path, "-storepass", String(PASS), "-keypass", String(PASS),
            ).redirectErrorStream(true).start()
            p.inputStream.readAllBytes()
            check(p.waitFor(60, TimeUnit.SECONDS) && p.exitValue() == 0) { "keytool failed" }
            return KeyStore.getInstance("PKCS12").apply { file.inputStream().use { load(it, PASS) } }
        }
    }
}
