// The "Type (optional)" box on a hero page with builds per damage type, for
// .github/workflows/layout-check.yml. Usage:
//   node typebox.cjs <site folder> <output folder> <chromium|webkit>
// <site folder> is a site made from builds-zip.py's test zip, where Abrams has
// a spirit build. At phone and PC size it opens /counter/abrams/ with
// JavaScript off (the default build shows, the box doesn't, every build is in
// the HTML) and on (the box starts at Gun, under the web app button, and
// switches the items without moving; Hybrid has no build, so the default
// shows with a note).
// It also notes that a hero without builds has no box, and how far the ad
// box is from the type box with ads on. Writes <engine>-typebox.json and
// screenshots; check.py checks them.

const http = require("http");
const fs = require("fs");
const path = require("path");
const playwright = require("playwright");

const [root, out, engine] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };

// index.html settings with ads on and made-up ad unit IDs (like shots.cjs).
function withAds(html) {
  html = html.replace(/(\n\s*ads:\s*)'[a-z-]*'/, "$1'on'");
  return html.replace(/(adSlots:\s*\{)([^}]*)\}/, (m, a, b) => a + b.replace(/''/g, "'1234567890'") + "}");
}

const server = http.createServer((req, res) => {
  let file = decodeURIComponent(req.url.split("?")[0]);
  if (file.endsWith("/")) file += "index.html";
  file = path.join(root, file);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  if (/[?&]ads=on/.test(req.url) && file.endsWith(".html")) res.end(withAds(fs.readFileSync(file, "utf8")));
  else res.end(fs.readFileSync(file));
});

// Run in the page: what shows.
function view() {
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const pick = document.querySelector(".type-pick");
  const box = pick && pick.querySelector("select");
  const note = pick && pick.querySelector(".type-note");
  const button = document.querySelector(".quick .btn.primary");
  const b = button && button.getBoundingClientRect();
  const p = visible(pick) ? pick.getBoundingClientRect() : null;
  return {
    boxShown: visible(box),
    value: box ? box.value : null,
    options: box ? [...box.options].map((o) => o.textContent) : [],
    note: visible(note) ? note.textContent : "",
    items: [...document.querySelectorAll("main .items li b")].filter(visible).map((el) => el.textContent),
    quick: [...document.querySelectorAll(".quick ol li b")].filter(visible).map((el) => el.textContent),
    headings: [...document.querySelectorAll("main h2.sec")].filter(visible).map((el) => el.textContent.trim()),
    boxUnderButton: !!(p && b && p.top >= b.bottom - 1 && pick.closest(".quick")),
    boxHeight: visible(box) ? Math.round(box.getBoundingClientRect().height) : 0,
    boxTop: visible(box) ? Math.round(box.getBoundingClientRect().top + window.scrollY) : null,
    boxFits: !p || (p.right <= document.querySelector(".quick").getBoundingClientRect().right + 0.5),
    horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
  };
}

// Run in the page: px between the ad box and the type box.
function adGap() {
  const ad = document.querySelector('.ad-slot[data-ad="counter"]');
  const box = document.querySelector(".type-pick select");
  if (!ad || !ad.getClientRects().length || !box) return null;
  const a = ad.getBoundingClientRect(), c = box.getBoundingClientRect();
  return Math.round(Math.hypot(Math.max(0, c.left - a.right, a.left - c.right), Math.max(0, c.top - a.bottom, a.top - c.bottom)));
}

const SIZES = {
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pc: { viewport: { width: 1440, height: 900 } },
};

server.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await playwright[engine].launch();
  const report = { errors: [] };
  try {
    const other = fs.readdirSync(path.join(root, "counter"))
      .filter((d) => d !== "abrams" && fs.existsSync(path.join(root, "counter", d, "index.html")))[0];
    const html = fs.readFileSync(path.join(root, "counter", "abrams", "index.html"), "utf8");
    report.inHtml = ["Spirit test item (lane)", "Spirit test item (mid)", "Spirit test item (late)"].every((t) => html.includes(t));
    for (const [size, options] of Object.entries(SIZES)) {
      const r = (report[size] = {});
      // JavaScript off.
      const off = await browser.newContext({ ...options, javaScriptEnabled: false, reducedMotion: "reduce" });
      await off.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const offPage = await off.newPage();
      await offPage.goto(`${url}counter/abrams/?ads=off`);
      r.noScript = await offPage.evaluate(view);
      await offPage.screenshot({ path: path.join(out, `${engine}-${size}-typebox-nojs.png`), fullPage: true });
      await off.close();

      // JavaScript on.
      const on = await browser.newContext({ ...options, reducedMotion: "reduce" });
      await on.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      const page = await on.newPage();
      page.on("pageerror", (e) => report.errors.push(`${size}: ${String(e).split("\n")[0]}`));
      await page.goto(`${url}counter/abrams/?ads=off`);
      await page.waitForTimeout(300);
      r.start = await page.evaluate(view);
      for (const type of ["spirit", "hybrid", "", "gun"]) {
        await page.selectOption(".type-pick select", type);
        r[type || "any"] = await page.evaluate(view);
        if (type === "spirit" || type === "hybrid") {
          await page.locator(".quick").screenshot({ path: path.join(out, `${engine}-${size}-typebox-${type}.png`) });
        }
      }
      await page.goto(`${url}counter/${other}/?ads=off`);
      r.otherHero = { hero: other, hasBox: await page.evaluate(() => !!document.querySelector(".type-pick, [data-build]")) };
      await page.goto(`${url}counter/abrams/?ads=on`);
      await page.waitForTimeout(300);
      r.adToBox = await page.evaluate(adGap);
      await on.close();
    }
  } catch (e) {
    report.errors.push(String(e).split("\n")[0]);
  } finally {
    fs.writeFileSync(path.join(out, `${engine}-typebox.json`), JSON.stringify(report, null, 1));
    await browser.close();
    server.close();
  }
});
