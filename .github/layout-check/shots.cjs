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

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const playwright = require("playwright");

const [root, out, engine] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".ico": "image/x-icon", ".css": "text/css" };

// index.html with SITE.ads switched on or off, and on with made-up ad unit
// IDs ('1234567890'), when the address ends in ?ads=on or ?ads=off.
function withAds(html, mode) {
  html = html.replace(/(\n\s*ads:\s*)'[a-z-]*'/, `$1'${mode}'`);
  if (mode === "on") html = html.replace(/(adSlots:\s*\{)([^}]*)\}/, (m, a, b) => a + b.replace(/''/g, "'1234567890'") + "}");
  return html;
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
        await page.goto(`${url}?ads=off#${tab}`);
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
            sideHeight: Math.round(side.height),
            contentStartsAfterSidebar: Math.round(main.top - side.bottom),
            contentTop: Math.round(main.top + window.scrollY),
            tabs: [...document.querySelectorAll(".os-tab")].map((t) => t.textContent.trim()),
            adsSetting: typeof SITE === "object" ? SITE.ads ?? null : null,
            adsPublisher: typeof SITE === "object" ? SITE.adsPublisher ?? null : null,
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
      await context.close();

      // The ad positions, with ads switched on.
      const adsContext = await browser.newContext({ ...options, reducedMotion: "reduce" });
      await adsContext.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const adsPage = await adsContext.newPage();
      const adsErrors = [];
      adsPage.on("pageerror", (e) => adsErrors.push(String(e)));
      const on = {};
      await adsPage.goto(`${url}?ads=on#about`);
      await adsPage.waitForTimeout(800);
      on.switchedOn = await adsPage.evaluate(() => typeof SITE === "object" && SITE.ads === "on");
      if (on.switchedOn) {
        on.about = await adsPage.evaluate(measureAd, "about");
        await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-about.png`), fullPage: true });
        await adsPage.goto(`${url}?ads=on#download`);
        await adsPage.waitForTimeout(500);
        on["download-no-system"] = await adsPage.evaluate(measureAd, "download");
        for (const os of ["web", "win", "lin"]) {
          await adsPage.click(`.os-tab[data-os="${os}"]`);
          await adsPage.waitForTimeout(300);
          on[`download-${os}`] = await adsPage.evaluate(measureAd, "download");
          await adsPage.screenshot({ path: path.join(out, `${engine}-${size}-ads-download-${os}.png`), fullPage: true });
        }
        for (const tab of ["profiles", "privacy"]) {
          await adsPage.goto(`${url}?ads=on#${tab}`);
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
