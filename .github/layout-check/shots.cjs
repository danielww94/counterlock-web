// Screenshots and layout numbers for the site, used by
// .github/workflows/layout-check.yml. Usage:
//   node shots.cjs <site folder> <output folder> <chromium|webkit>
// Serves the folder locally with no internet (the release and library
// lookups fall back the same way every time), then for a phone (iPhone 15,
// 393x852) and a PC (1440x900) saves About, Download, Counter Profiles and
// Privacy screenshots and writes report.json with where the sidebar ends and
// the page content starts. On About it also saves the view with the app
// screenshot covered, and the "What a matchup looks like" section on its own,
// for looking at that image. For the ads check it also notes the SITE.ads
// setting, how many ads are visible, and which ad files the page asked for.
//
// These first screenshots always have ads switched off (?ads=off below), so
// the layout comparisons keep working once ads are on for real. Then the ad
// positions are tried with ads switched on and made-up ad unit IDs
// (?ads=on): Google can't be reached, so each position stays an empty box,
// which is exactly the space kept for the ad. It notes where each box is, its
// size before and after an ad of that size "loads", whether it's in a form,
// and how far away the nearest button or link button is.
//
// It also notes whether the page asks for Cloudflare Web Analytics, and
// with a stand-in for it (the real one can't be reached, and would count the
// test as a visit) which page switches it would count as page views.
//
// Every page is opened by its own address (/, /download/, /profiles/,
// /privacy/). <site folder> is the site as published (.github/build-site.sh
// makes those folders). A site from before the pages had addresses (the base
// branch of the pull request that added them) only knows #links, so there it
// falls back to those.
//
// Last, it opens /privacy/ (the address AdSense uses for the privacy policy),
// the old #links (/#download and so on), and reloads a page, and notes where
// each lands and with which title.
//
// The counter pages (.github/build-pages.py): /counter/abrams/ and /counter/
// get the same layout, ads and analytics checks, plus their search details
// (title, one H1, description, canonical address, breadcrumbs) and their hero
// lists (names in page order, type headings if any). Every page with the
// sidebar also reports how each menu item is drawn (text per line, size, line
// spacing), for the "Hero Counters" / "Counter Profiles" check. Unknown
// addresses get 404.html, like on GitHub Pages.
//
// Then the sidebar menu at every width from a small phone to a PC (WIDTHS
// below): on every page with the sidebar, where each menu item is, its lines,
// size, whether its text overflows, and whether the page scrolls sideways.
// Screenshots of the top of About at a few of those widths. In Chromium it also opens
// /app/?enemy=abrams (the counter pages' button) and notes which enemy the
// web version picked. The site's sitemap.xml, robots.txt and 404.html are
// read straight from the folder.

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const playwright = require("playwright");

const [root, out, engine] = process.argv.slice(2);
const ADDRESS = { about: "", download: "download/", profiles: "profiles/", privacy: "privacy/" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".ico": "image/x-icon",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
const COUNTER = "counter/abrams/"; // the counter page the checks open

// index.html with SITE.ads switched on or off, and on with made-up ad unit
// IDs ('1234567890'), when the address ends in ?ads=on or ?ads=off.
function withAds(html, mode) {
  html = html.replace(/(\n\s*ads:\s*)'[a-z-]*'/, `$1'${mode}'`);
  if (mode === "on") html = html.replace(/(adSlots:\s*\{)([^}]*)\}/, (m, a, b) => a + b.replace(/''/g, "'1234567890'") + "}");
  return html;
}

// Stands in for Cloudflare's beacon.min.js. Like the real one, it counts a
// page view on load, on history.pushState and on popstate (Back, Forward,
// #links), and notes the page's address each time.
const FAKE_BEACON = `(() => {
  const at = () => location.pathname + location.hash;
  const views = window.__cfViews = [at()];
  const push = history.pushState;
  history.pushState = function () { const r = push.apply(this, arguments); views.push(at()); return r; };
  addEventListener('popstate', () => views.push(at()));
})();`;
async function fakeBeacon(context) {
  await context.route(/^https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/, (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_BEACON }));
}

const server = http.createServer((req, res) => {
  const ads = (req.url.match(/[?&]ads=(on|off)/) || [])[1];
  let file = decodeURIComponent(req.url.split("?")[0]);
  if (file.endsWith("/")) file += "index.html";
  file = path.join(root, file);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Like GitHub Pages: an unknown address gets 404.html, if the site has one.
    res.statusCode = 404;
    const missing = path.join(root, "404.html");
    if (fs.existsSync(missing)) {
      res.setHeader("content-type", "text/html");
      res.end(fs.readFileSync(missing));
    } else res.end();
    return;
  }
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  if (ads && file.endsWith(".html")) res.end(withAds(fs.readFileSync(file, "utf8"), ads));
  else res.end(fs.readFileSync(file));
});

// Opens a page by its address, or by its #link on a site from before the
// addresses (see the top).
async function openPage(page, url, tab, ads) {
  await page.goto(`${url}${ADDRESS[tab]}?ads=${ads}`);
  const shown = await page.evaluate((t) => !!document.querySelector(`#page-${t}.active`), tab).catch(() => false);
  if (!shown) await page.goto(`${url}?ads=${ads}#${tab}`);
}

// Run in the page: where it is, which page shows and its title.
function whereAmI() {
  const active = document.querySelector(".page.active");
  return { path: location.pathname, hash: location.hash, shown: active ? active.id : null, title: document.title };
}

// Run in the page: the visible ad box on the current page, if any.
function measureAd(name) {
  const box = document.querySelector(`.page.active .ad-slot[data-ad="${name}"]`);
  if (!box || !box.getClientRects().length) return { shown: false };
  const a = box.getBoundingClientRect();
  const ins = box.querySelector("ins.adsbygoogle");
  // Buttons, download links and anything that looks like a button, in the
  // page content (the sidebar is its own column). On a counter page every
  // link and fold-out counts too.
  const controls = [...document.querySelectorAll(
    "main a.dl, main button, main .btn, main .getbtn, main .link-row, main .icon-dl a, main .upload, main input, main select, main textarea"
    + (name === "counter" ? ", main a, main summary" : "")
  )].filter((el) => el.getClientRects().length);
  let nearest = Infinity, nearestName = "";
  for (const el of controls) {
    const c = el.getBoundingClientRect();
    const dx = Math.max(0, c.left - a.right, a.left - c.right);
    const dy = Math.max(0, c.top - a.bottom, a.top - c.bottom);
    const d = Math.hypot(dx, dy);
    if (d < nearest) { nearest = d; nearestName = `${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().replace(/\s+/g, " ").slice(0, 30)}"`; }
  }
  const before = Math.round(a.height);
  // An ad of the reserved size "loads": the box must not change size.
  if (ins) {
    const fake = document.createElement("div");
    fake.style.cssText = "width:100%;height:250px;background:#4a3a1a";
    ins.appendChild(fake);
    ins.setAttribute("data-ad-status", "filled");
  }
  return {
    shown: true,
    adHeight: ins ? Math.round(ins.getBoundingClientRect().height) : 0,
    boxHeightBefore: before,
    boxHeightAfter: Math.round(box.getBoundingClientRect().height),
    inForm: !!box.closest("form, dialog"),
    nearestControl: Math.round(nearest),
    nearestName,
  };
}

// Run in the page: how each sidebar menu item is drawn: its text on each line
// (a word's line is where its letters are), size, line spacing and height.
function navMetrics() {
  return [...document.querySelectorAll(".side .navitem")].map((item) => {
    const lines = [];
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        if (!node.data[i].trim()) { if (lines.length) lines[lines.length - 1].text += " "; continue; }
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (!lines.length || lines[lines.length - 1].top !== top) lines.push({ top, text: "" });
        lines[lines.length - 1].text += node.data[i];
      }
    }
    const style = getComputedStyle(item);
    return { label: item.textContent.replace(/\s+/g, " ").trim(), lines: lines.map((l) => l.text.trim()),
      fontSize: style.fontSize, lineHeight: style.lineHeight, height: Math.round(item.getBoundingClientRect().height) };
  });
}

// Run in the page: layout numbers, ads and analytics, and the search details.
function pageFacts() {
  const side = document.querySelector(".side").getBoundingClientRect();
  const main = document.querySelector("main").getBoundingClientRect();
  const meta = (sel, attr) => { const el = document.querySelector(sel); return el ? el.getAttribute(attr) : null; };
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    try { return JSON.parse(s.textContent); } catch (e) { return { error: String(e) }; }
  });
  const primary = document.querySelector("main .btn.primary");
  return {
    address: location.pathname + location.hash,
    title: document.title,
    sideHeight: Math.round(side.height),
    sideRight: Math.round(side.right),
    contentStartsAfterSidebar: Math.round(main.top - side.bottom),
    contentTop: Math.round(main.top + window.scrollY),
    horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    adsSetting: typeof SITE === "object" ? SITE.ads ?? null : null,
    adsPublisher: typeof SITE === "object" ? SITE.adsPublisher ?? null : null,
    analytics: !!window.__cfViews,
    visibleAds: [...document.querySelectorAll("ins.adsbygoogle, .ad-slot, iframe[src*='googlesyndication'], iframe[id^='aswift']")]
      .filter((el) => el.getClientRects().length > 0).length,
    adBoxes: document.querySelectorAll(".ad-slot").length,
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
    description: meta('meta[name="description"]', "content"),
    canonical: meta('link[rel="canonical"]', "href"),
    ogImage: meta('meta[property="og:image"]', "content"),
    twitterCard: meta('meta[name="twitter:card"]', "content"),
    ld,
    crumbs: [...document.querySelectorAll(".crumbs li")].map((li) => {
      const a = li.querySelector("a");
      return [li.textContent.trim(), a ? a.getAttribute("href") : null];
    }),
    primary: primary ? [primary.textContent.trim(), primary.getAttribute("href")] : null,
    downloadLink: !!document.querySelector('main a[href="/download/"]'),
    navCurrent: [...document.querySelectorAll(".navitem[aria-current]")].map((a) => a.textContent.trim()),
    // The hero lists (/counter/ cards, "Browse all heroes" links): one list,
    // names in page order, no type headings, and the short line on each card.
    heroLists: document.querySelectorAll("main .hero-cards, main .hero-links").length,
    heroNames: [...document.querySelectorAll("main .hero-cards b, main .hero-links a")].map((el) => el.textContent.trim()),
    cardLines: document.querySelectorAll("main .hero-cards small").length,
    typeHeadings: [...document.querySelectorAll("main h2, main h3")].map((h) => h.textContent.trim())
      .filter((t) => /\b(gun|spirit|hybrid|other)\b/i.test(t)),
    heroLinks: [...new Set([...document.querySelectorAll('main a[href^="/counter/"]')].map((a) => a.getAttribute("href")))]
      .filter((h) => h !== "/counter/").length,
    privacyLink: !!document.querySelector('.side a[href="/privacy/"]'),
  };
}

// Phones, tablets (portrait and landscape) and PCs, for the menu sweep.
const WIDTHS = [320, 360, 375, 393, 412, 430, 768, 820, 834, 1024, 1280, 1440];
const SWEEP_PAGES = { about: "", download: "download/", profiles: "profiles/", privacy: "privacy/",
  counter: COUNTER, counterIndex: "counter/", notFound: "no-such-page/" };
const SWEEP_SHOTS = [320, 393, 768, 834, 1280];

// Run in the page: the menu's layout for the width sweep.
function menuLayout() {
  const side = document.querySelector(".side");
  const style = getComputedStyle(side);
  const inner = side.getBoundingClientRect().right - parseFloat(style.paddingRight);
  return {
    horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    // Buttons in a row whose text no longer fits (the Download page's tabs).
    clipped: [...document.querySelectorAll(".page.active .os-tab")]
      .filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim()),
    sideInnerRight: Math.round(inner),
    sideHeight: Math.round(side.getBoundingClientRect().height),
    items: [...document.querySelectorAll(".side .navitem")].map((item) => {
      const r = item.getBoundingClientRect();
      const tick = item.querySelector(".tick").getBoundingClientRect();
      // The text's own width (a range), which may be wider than the item.
      const range = document.createRange();
      range.selectNodeContents(item);
      const text = range.getBoundingClientRect();
      return { label: item.textContent.replace(/\s+/g, " ").trim(), left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height),
        textRight: Math.round(text.right), overflow: item.scrollWidth > item.clientWidth + 1,
        tickLeft: Math.round(tick.left), fontSize: getComputedStyle(item).fontSize };
    }),
  };
}

const SIZES = {
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pc: { viewport: { width: 1440, height: 900 } },
};

server.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await playwright[engine].launch();
  const report = {};
  try {
    for (const [size, options] of Object.entries(SIZES)) {
      const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await fakeBeacon(context);
      const page = await context.newPage();
      // Every request to Google's ad servers (they are blocked, like all
      // outside requests, but still show what the page tried to load).
      const adRequests = new Set();
      page.on("request", (r) => {
        if (/googlesyndication\.com|doubleclick\.net|adservice\.google|fundingchoicesmessages\.google/.test(r.url())) adRequests.add(r.url());
      });
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      for (const tab of ["about", "download", "profiles", "privacy"]) {
        await openPage(page, url, tab, "off");
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(out, `${engine}-${size}-${tab}.png`) });
        // The same view with the app screenshot covered, for check.py when a
        // pull request replaces that image.
        const shot = page.locator(".shot img");
        if (tab === "about") {
          await page.screenshot({ path: path.join(out, `${engine}-${size}-about-masked.png`), mask: [shot] });
        }
        report[`${size}-${tab}`] = await page.evaluate(() => {
          const side = document.querySelector(".side").getBoundingClientRect();
          const main = document.querySelector("main").getBoundingClientRect();
          return {
            address: location.pathname + location.hash,
            title: document.title,
            sideHeight: Math.round(side.height),
            sideRight: Math.round(side.right),
            navLabels: [...document.querySelectorAll(".side .navitem")].map((n) => n.textContent.trim()),
            contentStartsAfterSidebar: Math.round(main.top - side.bottom),
            contentTop: Math.round(main.top + window.scrollY),
            tabs: [...document.querySelectorAll(".os-tab")].map((t) => t.textContent.trim()),
            adsSetting: typeof SITE === "object" ? SITE.ads ?? null : null,
            adsPublisher: typeof SITE === "object" ? SITE.adsPublisher ?? null : null,
            analytics: !!window.__cfViews,
            visibleAds: [...document.querySelectorAll("ins.adsbygoogle, .ad-slot, iframe[src*='googlesyndication'], iframe[id^='aswift']")]
              .filter((el) => el.getClientRects().length > 0).length,
          };
        });
        report[`${size}-${tab}`].adRequests = [...adRequests];
        report[`${size}-${tab}`].nav = await page.evaluate(navMetrics);
        if (tab === "about") {
          const src = (await shot.getAttribute("src")) || "";
          report["shotImage"] = crypto.createHash("sha256").update(src).digest("hex");
          // The "What a matchup looks like" section, from its heading to the caption.
          await shot.scrollIntoViewIfNeeded();
          await page.waitForFunction(() => document.querySelector(".shot img").complete);
          const clip = await page.evaluate(() => {
            const fig = document.querySelector(".shot");
            const top = fig.previousElementSibling.getBoundingClientRect().top + window.scrollY - 16;
            const bottom = fig.nextElementSibling.getBoundingClientRect().bottom + window.scrollY + 16;
            return { x: 0, y: top, width: document.documentElement.clientWidth, height: bottom - top };
          });
          await page.screenshot({ path: path.join(out, `${engine}-${size}-about-matchup.png`), fullPage: true, clip });
        }
      }
      // The counter pages, as published, with ads off.
      const counterSite = fs.existsSync(path.join(root, COUNTER, "index.html"));
      report["counterPages"] = counterSite;
      if (counterSite) {
        for (const [key, address] of [["counter", COUNTER], ["counterIndex", "counter/"]]) {
          await page.goto(`${url}${address}?ads=off`);
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(out, `${engine}-${size}-${key}.png`) });
          await page.screenshot({ path: path.join(out, `${engine}-${size}-${key}-full.png`), fullPage: true });
          report[`${size}-${key}`] = { ...(await page.evaluate(pageFacts)), nav: await page.evaluate(navMetrics), adRequests: [...adRequests] };
        }
        // An unknown address shows 404.html.
        const lost = await page.goto(`${url}no-such-page/`);
        // (No AdSense script there, so it stays out of the ads-off checks.)
        const { adsSetting, ...facts } = await page.evaluate(pageFacts);
        report[`${size}-notFound`] = { status: lost.status(), ...facts, nav: await page.evaluate(navMetrics),
          links: await page.$$eval("main a", (as) => as.map((a) => a.getAttribute("href"))) };
        await page.screenshot({ path: path.join(out, `${engine}-${size}-404.png`) });
      }
      report[`${size}-pageErrors`] = pageErrors;

      // Page switches the analytics counts: sidebar buttons, the Privacy &
      // rules link, Back, Forward. WebKit's Playwright build crashed a page
      // here on the base branch's site (#links), so a crash is noted (and
      // fails check.py for this pull request's site) instead of stopping the
      // whole run, and the later checks each use a tab of their own.
      const firstLine = (e) => String(e).split("\n")[0];
      const an = (report[`${size}-analytics`] = {});
      try {
        await openPage(page, url, "about", "off");
        await page.waitForTimeout(500);
        if (await page.evaluate(() => !!window.__cfViews && (window.__cfViews.length = 0, true))) {
          await page.click('.navitem[data-nav="download"]');
          await page.click('.navitem[data-nav="profiles"]');
          await page.click('.side .sidelinks a[href*="privacy"]');
          await page.waitForTimeout(300);
          await page.goBack();
          await page.waitForTimeout(300);
          an.afterBack = await page.evaluate(whereAmI);
          await page.goForward();
          await page.waitForTimeout(300);
          an.views = await page.evaluate(() => window.__cfViews);
          an.afterForward = await page.evaluate(whereAmI);
        }
      } catch (e) {
        an.error = firstLine(e);
      }
      // Reloading keeps the page: the address it ended on, loaded again.
      try {
        const again = await context.newPage();
        await again.goto(an.afterForward ? `${url.replace(/\/$/, "")}${an.afterForward.path}${an.afterForward.hash}` : `${url}privacy/`);
        await again.waitForTimeout(500);
        an.afterReload = await again.evaluate(whereAmI);
        await again.close();
      } catch (e) {
        an.reloadError = firstLine(e);
      }

      // Old links (/#download and so on), opened afresh like a bookmark, land
      // on the page's own address. So does one typed into the address bar.
      const old = {};
      for (const link of ["#about", "#download", "#profiles", "#privacy", "privacy/#privacy", "download/#profiles", "typed"]) {
        const tab = await context.newPage();
        try {
          if (link === "typed") {
            await tab.goto(`${url}?ads=off`);
            await tab.evaluate(() => { location.hash = "#download"; });
          } else {
            const [folder, hash] = link.split("#");
            await tab.goto(`${url}${folder}?ads=off#${hash}`);
          }
          await tab.waitForTimeout(300);
          old[link] = await tab.evaluate(whereAmI);
        } catch (e) {
          old[link] = { error: firstLine(e) };
        }
        await tab.close().catch(() => {});
      }
      report[`${size}-oldLinks`] = old;

      // getcounterlock.com/privacy/ must land on the Privacy & rules page.
      const landing = await context.newPage();
      await landing.goto(`${url}privacy/`);
      await landing.waitForTimeout(800);
      report[`${size}-privacyAddress`] = await landing.evaluate(() => {
        const title = document.querySelector("#t-privacy");
        return {
          landedOn: location.pathname + location.hash,
          pageTitle: document.title,
          privacyShown: !!document.querySelector("#page-privacy.active"),
          titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
          viewportHeight: window.innerHeight,
        };
      });
      await landing.screenshot({ path: path.join(out, `${engine}-${size}-privacy-address.png`) });
      await context.close();

      // The ad positions, with ads switched on.
      const adsContext = await browser.newContext({ ...options, reducedMotion: "reduce" });
      await adsContext.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await fakeBeacon(adsContext);
      const adsPage = await adsContext.newPage();
      const adsErrors = [];
      adsPage.on("pageerror", (e) => adsErrors.push(String(e)));
      const on = {};
      await openPage(adsPage, url, "about", "on");
      await adsPage.waitForTimeout(800);
      on.switchedOn = await adsPage.evaluate(() => typeof SITE === "object" && SITE.ads === "on");
      if (on.switchedOn) {
        on.about = await adsPage.evaluate(measureAd, "about");
        await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-about.png`), fullPage: true });
        await openPage(adsPage, url, "download", "on");
        await adsPage.waitForTimeout(500);
        on["download-no-system"] = await adsPage.evaluate(measureAd, "download");
        for (const os of ["web", "win", "lin"]) {
          await adsPage.click(`.os-tab[data-os="${os}"]`);
          await adsPage.waitForTimeout(300);
          on[`download-${os}`] = await adsPage.evaluate(measureAd, "download");
          await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-download-${os}.png`), fullPage: true });
        }
        if (report["counterPages"]) {
          await adsPage.goto(`${url}${COUNTER}?ads=on`);
          await adsPage.waitForTimeout(500);
          on.counter = await adsPage.evaluate(measureAd, "counter");
          await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-counter.png`), fullPage: true });
          await adsPage.goto(`${url}counter/?ads=on`);
          await adsPage.waitForTimeout(300);
          on.counterIndex = await adsPage.evaluate(() => ({
            visibleAds: [...document.querySelectorAll(".ad-slot, ins.adsbygoogle")].filter((el) => el.getClientRects().length).length,
          }));
        }
        for (const tab of ["profiles", "privacy"]) {
          await openPage(adsPage, url, tab, "on");
          await adsPage.waitForTimeout(500);
          on[tab] = await adsPage.evaluate(() => ({
            visibleAds: [...document.querySelectorAll(".ad-slot, ins.adsbygoogle")].filter((el) => el.getClientRects().length).length,
          }));
        }
      }
      on.pageErrors = adsErrors;
      report[`${size}-adsOn`] = on;
      await adsContext.close();
    }

    // The menu at every width, on every page with the sidebar.
    const sweep = (report["widths"] = {});
    for (const width of WIDTHS) {
      const touch = width < 1000 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {};
      const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, ...touch, reducedMotion: "reduce" });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const page = await context.newPage();
      for (const [key, address] of Object.entries(SWEEP_PAGES)) {
        if (["counter", "counterIndex", "notFound"].includes(key) && !report["counterPages"]) continue;
        if (address.endsWith("/") && !["counter", "counterIndex", "notFound"].includes(key)) {
          await openPage(page, url, key, "off");
        } else {
          await page.goto(`${url}${address}?ads=off`);
        }
        await page.waitForTimeout(250);
        try {
          sweep[`${width}-${key}`] = { ...(await page.evaluate(menuLayout)), nav: await page.evaluate(navMetrics) };
        } catch (e) {
          sweep[`${width}-${key}`] = { error: String(e).split("\n")[0] };
        }
        if (key === "about" && SWEEP_SHOTS.includes(width)) {
          await page.screenshot({ path: path.join(out, `${engine}-width-${width}-about.png`) });
        }
      }
      await context.close();
    }

    // The counter pages' button: /app/?enemy=abrams opens the web version
    // with Abrams picked (from 0.42). Chromium only: it loads all of Python.
    if (engine === "chromium" && fs.existsSync(path.join(root, "app", "index.html"))) {
      const appContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await appContext.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const app = await appContext.newPage();
      const appErrors = [];
      app.on("pageerror", (e) => appErrors.push(String(e).split("\n")[0]));
      const info = { version: JSON.parse(fs.readFileSync(path.join(root, "app", "version.json"), "utf8")).version };
      try {
        await app.goto(`${url}app/?enemy=abrams`);
        await app.waitForSelector("#main-view:not([hidden])", { timeout: 120000 });
        info.enemy = await app.inputValue("#enemy-hero");
        info.selection = (await app.textContent("#selection")).replace(/\s+/g, " ").trim();
        await app.screenshot({ path: path.join(out, `${engine}-app-enemy-abrams.png`) });
      } catch (e) {
        info.error = String(e).split("\n")[0];
      }
      info.pageErrors = appErrors;
      report["appLink"] = info;
      await appContext.close();
    }

    // Files search engines read.
    const read = (name) => (fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), "utf8") : null);
    const sitemap = read("sitemap.xml");
    report["siteFiles"] = {
      sitemap: sitemap && [...sitemap.matchAll(/<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?/g)].map((m) => [m[1], m[2] || null]),
      robots: read("robots.txt"),
      counterFolders: fs.existsSync(path.join(root, "counter"))
        ? fs.readdirSync(path.join(root, "counter")).filter((d) => fs.existsSync(path.join(root, "counter", d, "index.html"))).sort()
        : [],
      adsTxt: read("ads.txt"),
      ogImage: fs.existsSync(path.join(root, "og-image.png")),
    };
  } finally {
    fs.writeFileSync(path.join(out, `${engine}-report.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.close();
  }
});
