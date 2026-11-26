// Rule guards for the backend transport (ADR 0011 §8), moved from rules.test.ts: only it handles
// TLS, it never loosens the system's checks, and only MainActivity builds it.
import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { test } from "node:test";
import { BACKEND_TRANSPORT, code, KT_BACKEND, type KtMutation, ktViews, MAIN_ACTIVITY, mobileKt, mutationGaps, type Views } from "./rule-sources.ts";

// Anything that could make TLS accept a certificate or a host the system would refuse: a trust
// manager, a hostname verifier (set on a connection, as the default, or as a Kotlin property), an
// SSL context, a default factory, an insecure factory, a hand-made certificate check. No word
// boundary and any case, so the Java setters (`setHostnameVerifier`, `setDefaultHostnameVerifier`)
// and Kotlin's properties (`hostnameVerifier = `) are hits too. Reading the system's own verifier
// (`getDefaultHostnameVerifier()`) loosens nothing and is the one form left out.
const TLS_LOOSEN =
  /TrustManager|TrustAll|TrustEvery|(?<!getDefault)HostnameVerifier|SSLContext|(?<!get)Default\w*(Factory|Verifier)|ALLOW_ALL|getInsecure|SSLCertificateSocketFactory|checkServerTrusted|X509|NoopHostname|AllowAllHostname|InsecureTrust/i;
// Any SSL socket factory, as a type, a setter or a property.
const TLS_FACTORY = /SSLSocketFactory/i;
const ktMain = () => mobileKt.filter((s) => s.path.startsWith(join("android", "app", "src", "main") + sep));


// Each check reads every view of a file (rule-sources.ts), so a "//" in a string hides nothing.
const any = (views: Views, text: string, hit: (v: string) => boolean): boolean => views(text).some(hit);
const loosensTls = (_path: string, text: string, views: Views = ktViews): boolean => any(views, text, (v) => TLS_LOOSEN.test(v));
const factoryElsewhere = (path: string, text: string, views: Views = ktViews): boolean =>
  path !== BACKEND_TRANSPORT && any(views, text, (v) => TLS_FACTORY.test(v));
// MainActivity builds the transport once, with the origin and the main thread and no factory.
const ARGS = /HttpsBackendTransport\(([^()]*)\)/g;
const activityBuildsOtherwise = (path: string, text: string, views: Views = ktViews): boolean =>
  path === MAIN_ACTIVITY && any(views, text, (v) => JSON.stringify([...v.matchAll(ARGS)].map((m) => m[1])) !== '["origin, main"]');
// No file but the transport and MainActivity names the class.
const namedElsewhere = (path: string, text: string, views: Views = ktViews): boolean =>
  path !== BACKEND_TRANSPORT && path !== MAIN_ACTIVITY && any(views, text, (v) => /HttpsBackendTransport/.test(v));
const BUILDS = /HttpsBackendTransport\s*\(|::\s*HttpsBackendTransport/g;
const ownFileBuilds = (path: string, text: string, views: Views = ktViews): boolean =>
  path === BACKEND_TRANSPORT && any(views, text, (v) => [...v.matchAll(BUILDS)].length !== 0 || !/class HttpsBackendTransport internal constructor\(/.test(v));
const activityNamesMore = (path: string, text: string, views: Views = ktViews): boolean =>
  path === MAIN_ACTIVITY &&
  any(views, text, (v) =>
    [...v.matchAll(/HttpsBackendTransport/g)].length !== 2 ||
    !/^import org\.classbeat\.player\.backend\.HttpsBackendTransport$/m.test(v) ||
    [...v.matchAll(/HttpsBackendTransport\(origin, main\)/g)].length !== 1,
  );

test("only the backend transport handles TLS, and it never loosens the system's checks", () => {
  const main = ktMain();
  assert.ok(main.some((s) => s.path === BACKEND_TRANSPORT));
  // Every app Kotlin file, the transport too.
  assert.deepEqual(main.filter((s) => loosensTls(s.path, s.text)).map((s) => s.path), []);
  // A socket factory is named only in the transport, where the tests hand in theirs.
  assert.deepEqual(main.filter((s) => factoryElsewhere(s.path, s.text)).map((s) => s.path), []);
  for (const v of ktViews(main.find((s) => s.path === BACKEND_TRANSPORT)!.text)) assert.match(v, TLS_FACTORY);
  // The app builds the transport without one: the system's trust store.
  const activity = main.find((s) => s.path === MAIN_ACTIVITY)!;
  assert.ok(!activityBuildsOtherwise(activity.path, activity.text));
});

test("the TLS check catches every usual way to switch off certificate or hostname checks", () => {
  for (const bad of [
    "val v = HostnameVerifier { _, _ -> true }",
    "conn.setHostnameVerifier { _, _ -> true }",
    "conn.hostnameVerifier = HostnameVerifier { _, _ -> true }",
    "HttpsURLConnection.setDefaultHostnameVerifier { _, _ -> true }",
    "HttpsURLConnection.defaultHostnameVerifier = v",
    "HttpsURLConnection.setDefaultSSLSocketFactory(f)",
    "HttpsURLConnection.defaultSSLSocketFactory = f",
    "conn.sslSocketFactory = SSLCertificateSocketFactory.getInsecure(0, null)",
    "conn.sslSocketFactory = android.net.SSLCertificateSocketFactory.getDefault(0)",
    "object : X509TrustManager { }",
    "val tm = TrustManagerFactory.getInstance(a)",
    "override fun checkServerTrusted(c: Array<java.security.cert.X509Certificate>, a: String) {}",
    "val ctx = SSLContext.getInstance(\"TLS\")",
    "val c = javax.net.ssl.SSLContext.getDefault()",
    "SSLSocketFactory.ALLOW_ALL_HOSTNAME_VERIFIER",
    "NoopHostnameVerifier.INSTANCE",
    "val trustAll = arrayOf(t)",
  ]) {
    assert.match(code(bad), TLS_LOOSEN, bad);
  }
  // Reading the system's own verifier, and the transport's own use of a handed-in factory, are not hits.
  for (const fine of ["val v = HttpsURLConnection.getDefaultHostnameVerifier()", "tls?.let { conn.sslSocketFactory = it }", "conn.instanceFollowRedirects = false"]) {
    assert.doesNotMatch(code(fine), TLS_LOOSEN, fine);
  }
  for (const f of ["conn.setSSLSocketFactory(f)", "conn.sslSocketFactory = f", "val f: SSLSocketFactory? = null"]) {
    assert.match(code(f), TLS_FACTORY, f);
  }
});

test("only MainActivity builds the HTTPS backend transport", () => {
  // The origin is bound only by the constructor's argument, so no other file may name the class:
  // not to build one, not as a function reference, not through a type alias.
  const main = ktMain();
  assert.ok(main.some((s) => s.path === MAIN_ACTIVITY));
  assert.deepEqual(main.filter((s) => namedElsewhere(s.path, s.text)).map((s) => s.path), []);
  // The class's own file declares it and builds none, by call or by reference.
  const own = main.find((s) => s.path === BACKEND_TRANSPORT)!;
  assert.ok(!ownFileBuilds(own.path, own.text));
  // MainActivity builds exactly one, and nothing else in it names the class but its import.
  const activity = main.find((s) => s.path === MAIN_ACTIVITY)!;
  assert.ok(!activityNamesMore(activity.path, activity.text));
  // The check can fail: a second construction or a reference elsewhere is a hit.
  assert.ok(namedElsewhere("x.kt", "val t = HttpsBackendTransport(\"https://x.test\", p)"));
  assert.ok(ownFileBuilds(BACKEND_TRANSPORT, "class HttpsBackendTransport internal constructor(\nval f = ::HttpsBackendTransport"));
});

// Issue #859: each check above catches code that a "//" in a string on the same line hides from `code`.
const T = "tls?.let { conn.sslSocketFactory = it }";
const M = "HttpsBackendTransport(origin, main) else OfflineTransport(main)";
const C = "fun isClassId(id: String): Boolean = UUID.matches(id)";
const CALLS = join(...KT_BACKEND, "Calls.kt");
const hidden = (anchor: string, after: string): string => `${anchor}; val s = "//"; ${after}`;
const TRANSPORT_MUTATIONS: readonly KtMutation[] = [
  ["TLS loosened", BACKEND_TRANSPORT, T, hidden(T, "conn.hostnameVerifier = HostnameVerifier { _, _ -> true }"), true],
  ["TLS loosened", MAIN_ACTIVITY, M, hidden(M, "val c = SSLContext.getInstance(t)"), true],
  ["a socket factory outside the transport", MAIN_ACTIVITY, M, hidden(M, "val f: SSLSocketFactory? = null"), true],
  ["MainActivity builds it otherwise", MAIN_ACTIVITY, M, hidden(M, "val e = HttpsBackendTransport(evil, main)"), true],
  ["the transport named elsewhere", CALLS, C, hidden(C, "val f = ::HttpsBackendTransport"), true],
  ["its own file builds one", BACKEND_TRANSPORT, T, hidden(T, "HttpsBackendTransport(o, m)"), true],
  ["MainActivity names it again", MAIN_ACTIVITY, M, hidden(M, "val t = HttpsBackendTransport::class"), true],
];

test("the transport checks catch code a string's \"//\" hides on the same line", () => {
  const checks = new Map([
    ["TLS loosened", loosensTls],
    ["a socket factory outside the transport", factoryElsewhere],
    ["MainActivity builds it otherwise", activityBuildsOtherwise],
    ["the transport named elsewhere", namedElsewhere],
    ["its own file builds one", ownFileBuilds],
    ["MainActivity names it again", activityNamesMore],
  ]);
  assert.deepEqual(mutationGaps(TRANSPORT_MUTATIONS, checks), []);
  assert.deepEqual([...new Set(TRANSPORT_MUTATIONS.map(([c]) => c))].sort(), [...checks.keys()].sort());
});
