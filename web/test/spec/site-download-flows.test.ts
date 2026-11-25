// The download page on the fake site (docs/design/download.md): what each state shows, that the
// page reads one file of its own bundle and nothing else, and that nothing leaves the site. No
// network: Chrome is cut off and the fake answers every request.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, openSite, ORIGIN } from "../lib/site-fake.ts";
import type { FakeSite } from "../lib/site-fake.ts";
import { DOWNLOAD_STATES, releaseFile, sha } from "../lib/site-download-states.ts";
import { RELEASES_KEY } from "../lib/site-releases.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = (name: string): Promise<FakeSite> => {
  const state = DOWNLOAD_STATES.find((s) => s.name === name);
  assert.ok(state, name);
  return openSite(browser, state.path, { width: 1280, height: 800, script: state.script });
};
const texts = (site: FakeSite, sel: string): Promise<string[]> => site.page.locator(sel).allInnerTexts();

/** What the page asked for: its own files and the one release file, nothing from another origin, no API call. */
function assertOnlyOwnFiles(site: FakeSite): void {
  assert.deepEqual(site.external, [], "a request to another origin");
  assert.deepEqual(site.api, [], "an API call");
  assert.deepEqual(site.left, []);
  assert.equal(site.urls.filter((u) => u === `${ORIGIN}/releases.json`).length, 1, "the release file is read once");
  assert.ok(site.urls.every((u) => u.startsWith(`${ORIGIN}/`)), site.urls.join(" "));
}

describe("download page: latest found", () => {
  it("lists the four systems, each with its file, label, checksum and a link to its asset", async () => {
    const site = await open("download-found");
    await site.page.waitForSelector(".dl-row .btn");
    assert.equal(await site.page.title(), "Download the player · Class player");
    assert.deepEqual(await texts(site, "h1"), ["Download the player"]);
    assert.deepEqual(await texts(site, ".ver .num"), ["Version 0.1.0"]);
    assert.deepEqual(await texts(site, ".ver .when"), ["Released 25 Nov 2026"]);
    assert.equal(await site.page.locator(".ver .tag").count(), 0, "not a pre-release");
    assert.deepEqual(await texts(site, ".dl-row .n"), ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"]);
    assert.deepEqual(await texts(site, ".dl-row .tag"), ["Unsigned", "Unsigned", "Unsigned", "Unsigned"]);
    const files = await texts(site, ".dl-row .file");
    assert.equal(files.length, 4);
    // The checksum is plain text of the 64 characters, with no whitespace in it.
    const sums = await site.page.locator(".dl-row .sum").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    assert.deepEqual(sums, files.map(sha));
    assert.ok(sums.every((s) => /^[0-9a-f]{64}$/.test(s)));
    const links = await site.page.locator(".dl-row .btn").evaluateAll((els) => els.map((e) => [e.getAttribute("href"), e.getAttribute("aria-label")]));
    assert.deepEqual(
      links,
      files.map((f, i) => [`https://github.com/example/player/releases/download/player-v0.1.0/${f}`, `Download for ${["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"][i]}`]),
    );
    assert.equal(await site.page.locator(".notes").getAttribute("href"), "https://github.com/example/player/releases/tag/player-v0.1.0");
    assert.deepEqual(await texts(site, ".notes"), ["Release notes for 0.1.0"]);
    // No header navigation: the page is public.
    assert.equal(await site.page.locator("nav").count(), 0);
    assertOnlyOwnFiles(site);
    await site.context.close();
  });

  it("says every build is unsigned and shows only the spec's first sentence, with no placeholder and no other wording", async () => {
    const site = await open("download-found");
    await site.page.waitForSelector(".plate.unsigned");
    assert.deepEqual(await texts(site, ".plate.unsigned .head2"), ["These builds are unsigned"]);
    assert.deepEqual(await texts(site, ".plate.unsigned .dt"), ["macOS and Windows will warn you when you open them."]);
    assert.equal(await site.page.locator(".plate.unsigned").getAttribute("role"), null, "part of the page, not an alert");
    assert.doesNotMatch((await site.page.locator("main").innerText()).toLowerCase(), /owner wording|\[|safe|legal/);
    await site.context.close();
  });

  it("marks a pre-release with mixed signing, lists only the systems the release has and keeps the page free of other origins", async () => {
    const site = await open("download-mixed");
    await site.page.waitForSelector(".dl-row .btn");
    assert.deepEqual(await texts(site, ".ver .tag"), ["Pre-release"]);
    assert.deepEqual(await texts(site, ".ver .num"), ["Version 0.2.0-rc.1"]);
    assert.deepEqual(await texts(site, ".dl-row .n"), ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit"]);
    assert.deepEqual(await texts(site, ".dl-row .tag"), ["Signed", "Signed", "Unsigned"]);
    assert.deepEqual(await texts(site, ".plate.unsigned .head2"), ["Some builds are unsigned"]);
    assertOnlyOwnFiles(site);
    await site.context.close();
  });

  it("has no notice when every build is signed", async () => {
    const body = releaseFile("0.1.0", { signed: () => true });
    const site = await openSite(browser, "/download", { width: 390, height: 844, script: { [RELEASES_KEY]: { status: 200, body } } });
    await site.page.waitForSelector(".dl-row .btn");
    assert.equal(await site.page.locator(".plate").count(), 0);
    assert.deepEqual(await texts(site, ".dl-row .tag"), ["Signed", "Signed", "Signed", "Signed"]);
    await site.context.close();
  });
});

describe("download page: loading", () => {
  it("shows the four systems' places and the word Loading while the file is read, and no button, notice or checksum", async () => {
    const site = await open("download-loading");
    await site.page.waitForSelector(".status");
    await site.page.waitForTimeout(150);
    assert.deepEqual(await texts(site, ".status"), ["Looking for the latest release"]);
    assert.equal(await site.page.locator(".status").getAttribute("role"), "status");
    assert.deepEqual(await texts(site, ".dl-row .n"), ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"]);
    assert.deepEqual(await texts(site, ".dl-row .w"), ["Loading", "Loading", "Loading", "Loading"]);
    assert.equal(await site.page.locator(".btn, .sum, .plate, .note").count(), 0);
    await site.context.close();
  });
});

describe("download page: no release yet", () => {
  it("shows the note and no list, notice or button", async () => {
    const site = await open("download-none");
    await site.page.waitForSelector(".note");
    assert.deepEqual(await texts(site, ".note .head2"), ["No release yet"]);
    assert.deepEqual(await texts(site, ".note .dt"), ["No version of the player has been published. It will be listed here when there is one."]);
    assert.equal(await site.page.locator(".note").getAttribute("role"), "status");
    assert.equal(await site.page.locator(".dl-row, .btn, .plate, .notes").count(), 0);
    assertOnlyOwnFiles(site);
    await site.context.close();
  });

  it("is what the file in the bundle says today: no release", async () => {
    // No script for the release file: the page reads the file the build copied into dist/site.
    const site = await openSite(browser, "/download", { width: 390, height: 844 });
    await site.page.waitForSelector(".note");
    assert.deepEqual(await texts(site, ".note .head2"), ["No release yet"]);
    assertOnlyOwnFiles(site);
    await site.context.close();
  });
});

describe("download page: could not read", () => {
  for (const name of ["download-error", "download-error-shape"]) {
    it(`${name}: shows the alert plate and a Reload button that reads the page again`, async () => {
      const site = await open(name);
      await site.page.waitForSelector(".plate");
      assert.deepEqual(await texts(site, ".plate .head2"), ["The list of releases could not be read"]);
      assert.deepEqual(await texts(site, ".plate .dt"), ["Reload the page. If it happens again, the page is at fault, not your computer."]);
      assert.equal(await site.page.locator(".plate").getAttribute("role"), "alert");
      assert.equal(await site.page.locator(".dl-row, .sum, .notes").count(), 0);
      assert.equal(site.urls.filter((u) => u === `${ORIGIN}/releases.json`).length, 1);
      await site.page.getByRole("button", { name: "Reload", exact: true }).click();
      for (let i = 0; i < 100 && site.urls.filter((u) => u === `${ORIGIN}/releases.json`).length < 2; i += 1) await site.page.waitForTimeout(20);
      assert.equal(site.urls.filter((u) => u === `${ORIGIN}/releases.json`).length, 2, "the page was loaded again");
      assert.deepEqual(site.external, []);
      await site.context.close();
    });
  }

  it("shows the same plate when the read gets no answer at all", async () => {
    const site = await openSite(browser, "/download", { width: 390, height: 844, script: { [RELEASES_KEY]: { status: 0, fail: true } } });
    await site.page.waitForSelector(".plate");
    assert.deepEqual(await texts(site, ".plate .head2"), ["The list of releases could not be read"]);
    await site.context.close();
  });
});
