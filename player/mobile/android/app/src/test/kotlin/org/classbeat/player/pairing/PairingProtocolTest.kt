package org.classbeat.player.pairing

import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.Secrets
import org.classbeat.player.pairing.PairingProtocol.Device
import org.classbeat.player.pairing.PairingProtocol.Poll
import org.classbeat.player.pairing.PairingProtocol.Start
import org.classbeat.player.policy.OriginPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingProtocolTest {
    @Test
    fun `a start is read strictly and never polls faster than five seconds`() {
        val ok = PairingProtocol.parseStart(FakeBackend.started(), ORIGIN) as Start.Started
        assertEquals(5_000L, ok.intervalMs)
        assertFalse(ok.toString().contains(Secrets.deviceCode()))
        val fast = (FakeBackend.started().body as Map<*, *>) + ("interval" to 1.0)
        assertEquals(5_000L, (PairingProtocol.parseStart(FakeBackend.ok(fast), ORIGIN) as Start.Started).intervalMs)
        assertEquals(Start.TooMany, PairingProtocol.parseStart(FakeBackend.status(429), ORIGIN))
        assertEquals(Start.Unreachable, PairingProtocol.parseStart(HttpAnswer.Unreachable, ORIGIN))
        // The page must be on the backend's own origin.
        assertEquals(Start.Unexpected, PairingProtocol.parseStart(FakeBackend.started(origin = "https://evil.test"), ORIGIN))
        assertEquals(Start.Unexpected, PairingProtocol.parseStart(FakeBackend.started(code = "short"), ORIGIN))
    }

    @Test
    fun `a poll keeps only a well-formed device token`() {
        assertTrue(PairingProtocol.parsePoll(FakeBackend.token()) is Poll.Ok)
        assertEquals(Poll.Unexpected, PairingProtocol.parsePoll(FakeBackend.token(token = "cbp_x")))
        assertEquals(Poll.Retry(30_000), PairingProtocol.parsePoll(HttpAnswer.Http(503, null, 30)))
        assertEquals(Poll.Refused(PairingProtocol.PENDING), PairingProtocol.parsePoll(FakeBackend.error(400, "authorization_pending")))
        assertEquals(Poll.Unexpected, PairingProtocol.parsePoll(FakeBackend.error(400, "other")))
    }

    @Test
    fun `the 401 codes split into gone and expired`() {
        assertEquals(PairingProtocol.Refusal.GONE, PairingProtocol.tokenRefusal(FakeBackend.error(401, "token_revoked")))
        assertEquals(PairingProtocol.Refusal.GONE, PairingProtocol.tokenRefusal(FakeBackend.error(401, "token_unknown")))
        assertEquals(PairingProtocol.Refusal.EXPIRED, PairingProtocol.tokenRefusal(FakeBackend.error(401, "token_expired")))
        assertNull(PairingProtocol.tokenRefusal(FakeBackend.error(401, "other")))
        assertNull(PairingProtocol.tokenRefusal(FakeBackend.error(403, "token_revoked")))
        assertEquals(Device.Ok("Pixel"), PairingProtocol.parseDevice(FakeBackend.device()))
        assertEquals(Device.Unknown, PairingProtocol.parseDevice(FakeBackend.status(500)))
    }

    @Test
    fun `a record round-trips, hides its token and refuses another shape`() {
        val r = PairingRecord(ORIGIN, Secrets.token(), "coach@example.test")
        assertEquals(r, PairingRecord.parse(r.text(), false))
        assertFalse(r.toString().contains(Secrets.token()))
        assertNull(PairingRecord.parse(PairingRecord("http://example.test", Secrets.token(), null).text(), true))
        assertNull(PairingRecord.parse(PairingRecord(ORIGIN, "cbp_short", null).text(), false))
    }

    @Test
    fun `the build origin is HTTPS, or loopback HTTP in a debug build`() {
        assertEquals(ORIGIN, OriginPolicy.parseBackendOrigin("$ORIGIN/", false))
        assertNull(OriginPolicy.parseBackendOrigin("http://127.0.0.1:8000", false))
        assertEquals("http://127.0.0.1:8000", OriginPolicy.parseBackendOrigin("http://127.0.0.1:8000", true))
        assertNull(OriginPolicy.parseBackendOrigin("http://example.test", true))
        assertNull(OriginPolicy.parseBackendOrigin("https://example.test/path", false))
        assertNull(OriginPolicy.parseBackendOrigin("", false))
        assertNull(OriginPolicy.pairingPageOn(ORIGIN, "$ORIGIN/pair?code=X"))
        assertNull(OriginPolicy.pairingPageOn(ORIGIN, "$ORIGIN/../x"))
        assertNull(OriginPolicy.pairingPageOn(ORIGIN, "$ORIGIN.evil.test/pair"))
    }
}
