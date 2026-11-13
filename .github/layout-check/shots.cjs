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
// What search engines get: each main address opened with JavaScript off,
// noting which pages' content is in its HTML, which shows, the sidebar
// version, the download, GitHub, help and feedback email links, any "#"
// links left, the ad positions and any "opening soon" note. With JavaScript
// on: switching pages from the sidebar loads each page's content when it's
// needed (and only then), and that content works (the Windows download, the
// library, Help & feedback scrolling to its section).
//
// The Counter Profiles ad position is tried with fake library cards (the
// real library can't be reached), with SITE.profilesAds off (no ad) and on
// (?ads=all).
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
// IDs ('1234567890'), when the address ends in ?ads=on or ?ads=off. ?ads=all
// also switches on SITE.profilesAds (the Counter Profiles position).
function withAds(html, mode) {
  html = html.replace(/(\n\s*ads:\s*)'[a-z-]*'/, `$1'${mode === "off" ? "off" : "on"}'`);
  if (mode !== "off") html = html.replace(/(adSlots:\s*\{)([^}]*)\}/, (m, a, b) => a + b.replace(/''/g, "'1234567890'") + "}");
  if (mode === "all") html = html.replace(/(\n\s*profilesAds:\s*)'[a-z-]*'/, "$1'on'");
  return html;
}

// The settings in the repo's index.html (RELEASE and SITE), for the link checks.
function settingsOf(html) {
  const block = (name) => {
    const m = html.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`));
    return m ? Object.fromEntries([...m[1].matchAll(/^\s*(\w+):\s*'([^']*)'/gm)].map((x) => [x[1], x[2]])) : {};
  };
  return { release: block("RELEASE"), site: block("SITE") };
}

// Made-up cards for the Counter Profiles library (Supabase can't be reached
// in the test), so the ad's distance to the cards' buttons can be measured.
const FAKE_PROFILES = [1, 2, 3, 4].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, name: `Test profile ${n}`, description: "Made-up profile for the layout check.",
  patch: "10-05-2026", author_name: `tester${n}`, owner_id: `10000000-0000-4000-8000-00000000000${n}`, hero_count: 38,
  matchup_count: 20 + n, tips_heroes: ["Abrams"], downloads: 10 * n, rating_avg: 4.5, rating_count: n,
  created_at: "2026-11-01T12:00:00Z", updated_at: null, version: 1, file_path: `x/${n}.xml`, hidden_at: null,
}));
async function fakeLibrary(context) {
  await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/profiles/, (route) =>
    route.fulfill({ contentType: "application/json", headers: { "content-range": `0-${FAKE_PROFILES.length - 1}/*` },
      body: JSON.stringify(FAKE_PROFILES) }));
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
  const ads = (req.url.match(/[?&]ads=(on|off|all)/) || [])[1];
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
    + (name === "counter" || name === "profiles" ? ", main a, main summary" : "")
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
    // Counter pages: the web app button and Download link come before the
    // first section heading (Threat profile), and there is no quick answer box.
    buttonsAboveSections: (() => {
      const dl = document.querySelector('main a[href="/download/"]');
      const sec = document.querySelector("main h2.sec");
      if (!primary || !dl || !sec) return false;
      const top = sec.getBoundingClientRect().top;
      return primary.getBoundingClientRect().bottom <= top && dl.getBoundingClientRect().bottom <= top;
    })(),
    quickAnswer: !!document.querySelector("main .quick, main .quick-builds")
      || /\bQuick answer\b/i.test(document.querySelector("main") ? document.querySelector("main").textContent : ""),
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
    lede: (document.querySelector("main .lede") || {}).textContent || "",
    typeLabels: (document.querySelector("main").textContent.match(/\b(Gun|Spirit|Hybrid) hero\b\.?/g) || []),
    ver: (document.getElementById("ver") || {}).textContent || "",
  };
}

// Run in the page with JavaScript off: what search engines get from one
// main address.
function staticFacts() {
  const href = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute("href") : null; };
  const pages = [...document.querySelectorAll("main > .page")].map((s) => ({
    id: s.id, later: s.hasAttribute("data-later"), filled: s.children.length > 0, shown: s.getClientRects().length > 0,
  }));
  const main = document.querySelector("main");
  return {
    pages,
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
    ver: (document.getElementById("ver") || {}).textContent || "",
    navCurrent: [...document.querySelectorAll(".navitem[aria-current]")].map((a) => a.textContent.trim()),
    navLinks: [...document.querySelectorAll(".side .navitem")].map((a) => [a.tagName.toLowerCase(), a.getAttribute("href")]),
    dlWin: href("#dlWin"), dlLin: href("#dlLin"), ghRepo: href("#ghRepo"),
    releaseNotes: [...document.querySelectorAll(".verify[data-release]")].map((p) => [p.textContent.trim(), (p.querySelector("a") || {}).href || null]),
    helpMail: href("#helpMail"), helpMailText: (document.getElementById("helpMail") || {}).textContent || null,
    helpLink: href('.side .sidelinks a[data-jump="help"], .side .sidelinks a[href*="help"]'),
    // "#" links outside the sign-in dialogs, and links with no address on show.
    hashLinks: [...document.querySelectorAll('a[href="#"], a[href=""]')].filter((a) => !a.closest("dialog"))
      .map((a) => a.id || a.textContent.trim().slice(0, 30)),
    noHref: [...document.querySelectorAll("a:not([href])")].filter((a) => !a.closest("dialog") && a.getClientRects().length)
      .map((a) => a.id || a.textContent.trim().slice(0, 30)),
    adSlots: [...document.querySelectorAll(".ad-slot")].map((a) => a.dataset.ad),
    adsShown: [...document.querySelectorAll(".ad-slot")].filter((a) => a.getClientRects().length).length,
    soon: !!document.querySelector(".soon, #profilesSoon") || /opening soon/i.test(main ? main.textContent : ""),
    boardShown: !!document.querySelector("#profilesBoard") && document.querySelector("#profilesBoard").getClientRects().length > 0,
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
            ver: (document.getElementById("ver") || {}).textContent || "",
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
      await landing.close();

      // Switching pages: each page's content is fetched when it's opened (not
      // when a link to it is only pointed at), then works like before.
      const spa = (report[`${size}-switching`] = {});
      const sw = await context.newPage();
      const swErrors = [];
      sw.on("pageerror", (e) => swErrors.push(String(e).split("\\n")[0]));
      const lazy = () => [...document.querySelectorAll("main > .page[data-later]")].map((s) => s.id).sort();
      try {
        await sw.goto(`${url}?ads=off`);
        await sw.waitForTimeout(400);
        spa.startLater = await sw.evaluate(lazy);
        await sw.hover('.navitem[data-nav="download"]');
        await sw.waitForTimeout(400);
        spa.afterPointing = await sw.evaluate(lazy);
        await sw.click('.navitem[data-nav="download"]');
        await sw.waitForSelector("#page-download.active .os-tab", { timeout: 5000 });
        spa.download = await sw.evaluate(whereAmI);
        await sw.click('.os-tab[data-os="win"]');
        await sw.waitForTimeout(200);
        spa.windows = await sw.evaluate(() => {
          const a = document.getElementById("dlWin");
          return { shown: !!a && a.getClientRects().length > 0, href: a && a.getAttribute("href"),
            meta: (document.getElementById("dlWinMeta") || {}).textContent || "" };
        });
        await sw.click('.navitem[data-nav="profiles"]');
        await sw.waitForSelector("#page-profiles.active", { timeout: 5000 });
        await sw.waitForTimeout(300);
        spa.profiles = { ...(await sw.evaluate(whereAmI)), ...(await sw.evaluate(() => ({
          boardShown: !!document.getElementById("profilesBoard") && document.getElementById("profilesBoard").getClientRects().length > 0,
          message: ((document.getElementById("boardMsg") || {}).textContent || "").trim(),
          signIn: !!document.querySelector('#acctBar [data-open="dlgSignIn"]'),
        }))) };
        await sw.goBack();
        await sw.waitForTimeout(300);
        spa.back = await sw.evaluate(whereAmI);
        await sw.click('.side .sidelinks a[data-jump="help"]');
        await sw.waitForSelector("#page-about.active", { timeout: 5000 });
        await sw.waitForTimeout(900);
        spa.help = { ...(await sw.evaluate(whereAmI)), helpTop: await sw.evaluate(() => {
          const h = document.getElementById("help");
          return h ? Math.round(h.getBoundingClientRect().top) : null;
        }), viewportHeight: await sw.evaluate(() => window.innerHeight) };
        spa.endLater = await sw.evaluate(lazy);
      } catch (e) {
        spa.error = firstLine(e);
      }
      spa.pageErrors = swErrors;
      await sw.close();
      // Help & feedback from a counter page goes to /#help.
      if (report["counterPages"]) {
        const hp = await context.newPage();
        try {
          await hp.goto(`${url}${COUNTER}?ads=off`);
          await hp.click('.side .sidelinks a[href="/#help"]');
          await hp.waitForTimeout(800);
          spa.helpFromCounter = { ...(await hp.evaluate(whereAmI)), helpTop: await hp.evaluate(() => {
            const h = document.getElementById("help");
            return h ? Math.round(h.getBoundingClientRect().top) : null;
          }), viewportHeight: await hp.evaluate(() => window.innerHeight) };
        } catch (e) {
          spa.helpFromCounter = { error: firstLine(e) };
        }
        await hp.close();
      }
      await context.close();

      // The ad positions, with ads switched on.
      const adsContext = await browser.newContext({ ...options, reducedMotion: "reduce" });
      await adsContext.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await fakeBeacon(adsContext);
      await fakeLibrary(adsContext);
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
          on.counterIndex = await adsPage.evaluate(measureAd, "counter");
          await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-counter-index.png`), fullPage: true });
        }
        for (const tab of ["profiles", "privacy"]) {
          await openPage(adsPage, url, tab, "on");
          await adsPage.waitForTimeout(500);
          on[tab] = await adsPage.evaluate(() => ({
            visibleAds: [...document.querySelectorAll(".ad-slot, ins.adsbygoogle")].filter((el) => el.getClientRects().length).length,
            cards: document.querySelectorAll("#grid .card").length,
          }));
        }
        // SITE.profilesAds 'on' too: the Counter Profiles position, under the
        // (fake) library cards. Privacy & rules still has none.
        await openPage(adsPage, url, "profiles", "all");
        await adsPage.waitForTimeout(800);
        on.profilesCards = await adsPage.evaluate(() => document.querySelectorAll("#grid .card").length);
        on.profilesAll = await adsPage.evaluate(measureAd, "profiles");
        await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-profiles.png`), fullPage: true });
        await openPage(adsPage, url, "privacy", "all");
        await adsPage.waitForTimeout(500);
        on.privacyAll = await adsPage.evaluate(() => ({
          visibleAds: [...document.querySelectorAll(".ad-slot, ins.adsbygoogle")].filter((el) => el.getClientRects().length).length,
        }));
      }
      on.pageErrors = adsErrors;
      report[`${size}-adsOn`] = on;
      await adsContext.close();
    }

    // What search engines get: each main address with JavaScript off.
    const still = (report["static"] = {});
    const offContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    await offContext.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    const offPage = await offContext.newPage();
    for (const tab of Object.keys(ADDRESS)) {
      await offPage.goto(`${url}${ADDRESS[tab]}?ads=off`);
      still[tab] = await offPage.evaluate(staticFacts);
    }
    await offContext.close();

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
      settings: settingsOf(read("index.html") || ""),
      version: read("app/version.json") ? JSON.parse(read("app/version.json")).version : null,
    };
    // The feedback address never appears as plain text in a link (it's
    // written with HTML character codes), on any main address.
    const mail = report["siteFiles"].settings.site.supportEmail || "";
    report["siteFiles"].plainMailLinks = Object.entries(ADDRESS)
      .filter(([, a]) => mail && (read(`${a}index.html`) || "").includes(`href="mailto:${mail}"`)).map(([t]) => t);
  } finally {
    fs.writeFileSync(path.join(out, `${engine}-report.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.close();
  }
});
