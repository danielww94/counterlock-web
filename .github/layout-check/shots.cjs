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

const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const playwright = require("playwright");

const [root, out, engine] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".ico": "image/x-icon", ".css": "text/css" };

const server = http.createServer((req, res) => {
  let file = decodeURIComponent(req.url.split("?")[0]);
  if (file.endsWith("/")) file += "index.html";
  file = path.join(root, file);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});

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
      for (const tab of ["about", "download", "profiles", "privacy"]) {
        await page.goto(`${url}#${tab}`);
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
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(out, `${engine}-report.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.close();
  }
});
