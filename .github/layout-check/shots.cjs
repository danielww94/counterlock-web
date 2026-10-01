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

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const playwright = require("playwright");

const [root, out, engine] = process.argv.slice(2);
const ADDRESS = { about: "", download: "download/", profiles: "profiles/", privacy: "privacy/" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".ico": "image/x-icon", ".css": "text/css" };

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
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.end();
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
  // page content (the sidebar is its own column).
  const controls = [...document.querySelectorAll(
    "main a.dl, main button, main .btn, main .getbtn, main .link-row, main .icon-dl a, main .upload, main input, main select, main textarea"
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
      report[`${size}-pageErrors`] = pageErrors;

      // Page switches the analytics counts: sidebar buttons, the Privacy &
      // rules link, Back, Forward.
      await openPage(page, url, "about", "off");
      await page.waitForTimeout(500);
      if (await page.evaluate(() => !!window.__cfViews && (window.__cfViews.length = 0, true))) {
        await page.click('.navitem[data-nav="download"]');
        await page.click('.navitem[data-nav="profiles"]');
        await page.click('.side .sidelinks a[href*="privacy"]');
        await page.waitForTimeout(300);
        await page.goBack();
        await page.waitForTimeout(300);
        const shownAfterBack = await page.evaluate(whereAmI);
        await page.goForward();
        await page.waitForTimeout(300);
        report[`${size}-analytics`] = await page.evaluate(() => ({ views: window.__cfViews }));
        report[`${size}-analytics`].afterBack = shownAfterBack;
        report[`${size}-analytics`].afterForward = await page.evaluate(whereAmI);
        // Reloading keeps the page: load the same address again. (Not
        // page.reload(): WebKit's Playwright build crashed on it here, even
        // on the base branch's site.)
        await page.goto(page.url());
        await page.waitForTimeout(500);
        report[`${size}-analytics`].afterReload = await page.evaluate(whereAmI);
      }

      // Old links (/#download and so on), opened afresh like a bookmark, land
      // on the page's own address. So does one typed into the address bar.
      const old = {};
      for (const link of ["#about", "#download", "#profiles", "#privacy", "privacy/#privacy", "download/#profiles"]) {
        const [folder, hash] = link.split("#");
        await page.goto("about:blank");
        await page.goto(`${url}${folder}?ads=off#${hash}`);
        await page.waitForTimeout(300);
        old[link] = await page.evaluate(whereAmI);
      }
      await page.evaluate(() => { location.hash = "#download"; });
      await page.waitForTimeout(300);
      old.typed = await page.evaluate(whereAmI);
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
  } finally {
    fs.writeFileSync(path.join(out, `${engine}-report.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.close();
  }
});
