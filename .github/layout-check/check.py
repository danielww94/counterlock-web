"""Checks the screenshots and numbers from shots.cjs, for
.github/workflows/layout-check.yml. Usage: python check.py <before> <after>

- Phone (393x852): the page content starts right after the sidebar.
- PC (1440x900): the sidebar is the full window height, the content starts
  at the top, and the About page looks exactly as it did before (pixel for
  pixel), in every engine. If the pull request replaces the app screenshot
  on About, that image is covered in the comparison and everything else must
  still match.
- Ads off: no page shows an ad, and the only ad file the page asks for is
  Google's AdSense script with SITE.adsPublisher (the one Google uses to
  check the site). The checks above all run with ads off.
- Ads on (made-up ad unit IDs): About and Download each show one ad box, and
  Download only once a system is picked. The box keeps 250 px for the ad and
  doesn't change size when the ad loads, isn't in a form, and is at least
  150 px from any button or download link. Counter Profiles and Privacy show
  no ads. No script errors either way.
- Every page has its own address (/, /download/, /profiles/, /privacy/) and
  its own title, opening that address directly shows that page, and so does
  reloading it. Old links (/#download and so on) land on the new address.
- /privacy/ (the privacy policy address for AdSense) is the Privacy & rules
  page, with its title on screen.
- Cloudflare Web Analytics loads on every page (a stand-in, see shots.cjs),
  and counts the sidebar buttons, the Privacy & rules link, Back and Forward
  as page views, each under the page's own address.
- Sidebar menu: "Hero Counters" is drawn like "Counter Profiles" on every
  page that has the sidebar (the four main pages, both counter pages, 404):
  same text size, line spacing and height. At PC size both are on two lines
  (HERO / COUNTERS, COUNTER / PROFILES); at phone size both are on one line.
- If the pull request changes the sidebar's menu or how it is drawn, the About
  comparison covers only the page content (right of the sidebar).
- Counter pages (when the site has them, made from the latest release):
  /counter/abrams/ at phone and PC size has the same layout as the other
  pages, one H1 "How to counter Abrams in Deadlock", its own title,
  description and canonical address, a share picture, BreadcrumbList data
  matching the breadcrumbs (Home > Counters > Abrams), the button to
  /app/?enemy=abrams, a Download link, every hero, the
  Privacy & rules link, analytics, no horizontal scrolling, and the ad rules
  above (ads off: nothing; ads on: one 250 px box, at least 150 px from any
  button, link or fold-out). Browse all heroes and /counter/ are one list of
  every hero, A to Z, with no type headings; /counter/ keeps the short line
  under each hero name. /counter/ shows no ads. Unknown addresses get 404.html with links to Home, the counters and
  Download.
- sitemap.xml lists every page, each counter page included, with a date;
  robots.txt points to it; ads.txt is still there.
- /app/?enemy=abrams opens the web version with Abrams picked (checked in
  Chromium; a release older than 0.42 predates these links, so then it's
  only noted).
"""

import json
import sys

MIN_GAP = 150  # px between an ad and the nearest button or download link
PATHS = {"about": "/", "download": "/download/", "profiles": "/profiles/", "privacy": "/privacy/"}
# Old link (shots.cjs opens it afresh) -> the page it must land on.
OLD_LINKS = {"#about": "about", "#download": "download", "#profiles": "profiles", "#privacy": "privacy",
             "privacy/#privacy": "privacy", "download/#profiles": "profiles", "typed": "download"}
from pathlib import Path

from PIL import Image, ImageChops

before, after = Path(sys.argv[1]), Path(sys.argv[2])
problems = []

SITE_URL = "https://getcounterlock.com"
MAIN_PAGES = [SITE_URL + p for p in ("/", "/download/", "/profiles/", "/privacy/")]


def version_tuple(text):
    try:
        return tuple(int(x) for x in str(text).split("."))
    except ValueError:
        return (0,)


def check_ad_box(engine, size, key, ad):
    """The ad position rules, for one measured box with ads on."""
    print(f"{engine} {size} ad {key}: {json.dumps(ad)}")
    if not ad.get("shown"):
        problems.append(f"{engine} {size} {key}: the ad box doesn't show with ads on")
        return
    if ad["adHeight"] != 250:
        problems.append(f"{engine} {size} {key}: {ad['adHeight']} px kept for the ad instead of 250")
    if ad["boxHeightBefore"] != ad["boxHeightAfter"]:
        problems.append(f"{engine} {size} {key}: the page jumps when the ad loads ({ad['boxHeightBefore']} to {ad['boxHeightAfter']} px)")
    if ad["inForm"]:
        problems.append(f"{engine} {size} {key}: the ad is inside a form or dialog")
    if ad["nearestControl"] < MIN_GAP:
        problems.append(f"{engine} {size} {key}: the ad is {ad['nearestControl']} px from {ad['nearestName']} (needs {MIN_GAP})")


def check_nav(engine, size, where, nav):
    """Hero Counters looks like Counter Profiles: same size, line spacing and
    height, two lines at PC size and one on a phone."""
    by_label = {item["label"]: item for item in nav or []}
    profiles, counters = by_label.get("Counter Profiles"), by_label.get("Hero Counters")
    if not profiles or not counters:
        problems.append(f"{engine} {size} {where}: the sidebar needs Counter Profiles and Hero Counters ({list(by_label)})")
        return
    print(f"{engine} {size} {where} sidebar: Counter Profiles {profiles['lines']} Hero Counters {counters['lines']}")
    for key in ("fontSize", "lineHeight", "height"):
        if profiles[key] != counters[key]:
            problems.append(f"{engine} {size} {where}: Hero Counters {key} {counters[key]} differs from Counter Profiles {profiles[key]}")
    want = (["Counter", "Profiles"], ["Hero", "Counters"]) if size == "pc" else (["Counter Profiles"], ["Hero Counters"])
    got = tuple([line.strip() for line in item["lines"]] for item in (profiles, counters))
    if got != want:
        problems.append(f"{engine} {size} {where}: sidebar lines are {got[0]} and {got[1]}, expected {want[0]} and {want[1]}")


def check_hero_list(engine, size, where, view, heroes, cards):
    """One list of every hero, A to Z, no type headings (a hero's type
    depends on the build)."""
    names = view.get("heroNames") or []
    if view.get("heroLists") != 1:
        problems.append(f"{where}: {view.get('heroLists')} hero lists instead of 1")
    if view.get("typeHeadings"):
        problems.append(f"{where}: type headings {view.get('typeHeadings')}")
    if len(names) != heroes or len(set(names)) != heroes:
        problems.append(f"{where}: {len(names)} hero names ({len(set(names))} different) for {heroes} heroes")
    elif names != sorted(names, key=str.lower):
        problems.append(f"{where}: heroes aren't A to Z: {names}")
    if cards and view.get("cardLines") != heroes:
        problems.append(f"{where}: the short line shows under {view.get('cardLines')} of {heroes} heroes")


def check_counter_pages(engine, report):
    if not report.get("counterPages"):
        print(f"::warning::{engine}: the site has no counter pages (no Counterlock-web.zip?), so they weren't checked")
        return
    for size in ("phone", "pc"):
        v = report.get(f"{size}-counter", {})
        print(f"{engine} {size} counter page: {json.dumps({k: v.get(k) for k in ('title', 'h1', 'canonical', 'description', 'crumbs', 'primary', 'sideHeight', 'contentStartsAfterSidebar', 'heroLists', 'cardLines')})}")
        where = f"{engine} {size} /counter/abrams/"
        if size == "phone":
            if not 0 <= v.get("contentStartsAfterSidebar", -1) <= 1 or v.get("sideHeight", 9999) >= 852:
                problems.append(f"{where}: content starts {v.get('contentStartsAfterSidebar')} px after a {v.get('sideHeight')} px sidebar")
        elif v.get("sideHeight") != 900 or v.get("contentTop") != 0:
            problems.append(f"{where}: sidebar {v.get('sideHeight')} px, content top {v.get('contentTop')} px")
        if v.get("horizontalScroll"):
            problems.append(f"{where}: the page scrolls sideways")
        if v.get("h1") != ["How to counter Abrams in Deadlock"]:
            problems.append(f"{where}: needs one H1 'How to counter Abrams in Deadlock' ({v.get('h1')})")
        if not str(v.get("title", "")).startswith("How to counter Abrams in Deadlock"):
            problems.append(f"{where}: title is {v.get('title')!r}")
        if v.get("canonical") != f"{SITE_URL}/counter/abrams/":
            problems.append(f"{where}: canonical address is {v.get('canonical')}")
        if not 50 <= len(v.get("description") or "") <= 160:
            problems.append(f"{where}: the description should be 50 to 160 characters ({v.get('description')!r})")
        if v.get("ogImage") != f"{SITE_URL}/og-image.png" or v.get("twitterCard") != "summary_large_image":
            problems.append(f"{where}: share preview tags missing ({v.get('ogImage')}, {v.get('twitterCard')})")
        want = [["Home", "/"], ["Counters", "/counter/"], ["Abrams", None]]
        if v.get("crumbs") != want:
            problems.append(f"{where}: breadcrumbs are {v.get('crumbs')}")
        lists = [d for d in v.get("ld", []) if d.get("@type") == "BreadcrumbList"]
        names = [(i.get("name"), i.get("item")) for i in lists[0].get("itemListElement", [])] if lists else []
        if names != [("Home", SITE_URL + "/"), ("Counters", SITE_URL + "/counter/"), ("Abrams", SITE_URL + "/counter/abrams/")]:
            problems.append(f"{where}: BreadcrumbList data is {names}")
        if v.get("primary") != ["Open Abrams in the Counterlock web app", "/app/?enemy=abrams"]:
            problems.append(f"{where}: the main button is {v.get('primary')}")
        if not v.get("downloadLink") or not v.get("privacyLink"):
            problems.append(f"{where}: the Download or Privacy & rules link is missing")
        if v.get("navCurrent") != ["Hero Counters"]:
            problems.append(f"{where}: the sidebar marks {v.get('navCurrent')} as the open page")
        heroes = len(report["siteFiles"]["counterFolders"])
        if v.get("heroLinks") != heroes:
            problems.append(f"{where}: Browse all heroes links {v.get('heroLinks')} of {heroes} heroes")
        check_hero_list(engine, size, f"{where} Browse all heroes", v, heroes, cards=False)
        check_nav(engine, size, "/counter/abrams/", v.get("nav"))
        if v.get("adBoxes") != 1:
            problems.append(f"{where}: {v.get('adBoxes')} ad positions instead of 1")
        idx = report.get(f"{size}-counterIndex", {})
        if idx.get("h1") != ["Deadlock counters for every hero"] or idx.get("canonical") != f"{SITE_URL}/counter/" \
                or idx.get("heroLinks") != heroes or idx.get("horizontalScroll"):
            problems.append(f"{engine} {size} /counter/: {json.dumps({k: idx.get(k) for k in ('h1', 'canonical', 'heroLinks', 'horizontalScroll')})}")
        check_hero_list(engine, size, f"{engine} {size} /counter/", idx, heroes, cards=True)
        check_nav(engine, size, "/counter/", idx.get("nav"))
        lost = report.get(f"{size}-notFound", {})
        print(f"{engine} {size} 404: status {lost.get('status')}, links {lost.get('links')}")
        if lost.get("status") != 404 or not {"/", "/counter/", "/download/"} <= set(lost.get("links") or []) \
                or lost.get("visibleAds") or not lost.get("analytics") or lost.get("horizontalScroll"):
            problems.append(f"{engine} {size}: unknown addresses don't get a 404 page linking Home, Counters and Download ({lost})")
        check_nav(engine, size, "404", lost.get("nav"))
        on = report.get(f"{size}-adsOn", {})
        if on.get("switchedOn"):
            check_ad_box(engine, size, "counter", on.get("counter", {}))
            if on.get("counterIndex", {}).get("visibleAds"):
                problems.append(f"{engine} {size} /counter/: shows an ad")

    files = report["siteFiles"]
    urls = dict(files.get("sitemap") or [])
    expected = MAIN_PAGES + [f"{SITE_URL}/counter/"] + [f"{SITE_URL}/counter/{d}/" for d in files["counterFolders"]]
    missing = [u for u in expected if u not in urls]
    undated = [u for u, d in urls.items() if not d]
    print(f"{engine} sitemap.xml: {len(urls)} addresses")
    if missing or undated:
        problems.append(f"{engine} sitemap.xml: missing {missing}, no date on {undated}")
    if f"Sitemap: {SITE_URL}/sitemap.xml" not in (files.get("robots") or ""):
        problems.append(f"{engine} robots.txt doesn't point to the sitemap ({files.get('robots')!r})")
    if not (files.get("adsTxt") or "").strip() or not files.get("ogImage"):
        problems.append(f"{engine}: ads.txt or og-image.png is missing from the site")

    app = report.get("appLink")
    if app is not None:
        print(f"{engine} /app/?enemy=abrams: {json.dumps(app)}")
        if version_tuple(app.get("version")) >= (0, 42):
            if app.get("enemy") != "Abrams" or app.get("pageErrors"):
                problems.append(f"{engine}: /app/?enemy=abrams doesn't open with Abrams picked ({app})")
        else:
            print(f"::notice::The latest release ({app.get('version')}) predates /app/?enemy= links (0.42), so the link opens the app without a pick until 0.42 is released.")


for report_file in sorted(after.glob("*-report.json")):
    engine = report_file.name.split("-")[0]
    report = json.loads(report_file.read_text())
    for tab in ("about", "download"):
        phone, pc = report[f"phone-{tab}"], report[f"pc-{tab}"]
        print(f"{engine} {tab}: phone sidebar {phone['sideHeight']} px, content starts "
              f"{phone['contentStartsAfterSidebar']} px after it; PC sidebar {pc['sideHeight']} px")
        if not 0 <= phone["contentStartsAfterSidebar"] <= 1:
            problems.append(f"{engine} phone {tab}: content starts {phone['contentStartsAfterSidebar']} px after the sidebar")
        check_nav(engine, "phone", tab, phone.get("nav"))
        check_nav(engine, "pc", tab, pc.get("nav"))
        if phone["sideHeight"] >= 852:
            problems.append(f"{engine} phone {tab}: the sidebar is a whole screen tall ({phone['sideHeight']} px)")
        if pc["sideHeight"] != 900 or pc["contentTop"] != 0:
            problems.append(f"{engine} PC {tab}: sidebar {pc['sideHeight']} px, content top {pc['contentTop']} px")
    # While ads are off, only Google's check script may load, and nothing shows.
    for key, view in report.items():
        if not isinstance(view, dict) or "adsSetting" not in view:
            continue
        script = f"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={view['adsPublisher']}"
        if view["visibleAds"]:
            problems.append(f"{engine} {key}: ads are off, but {view['visibleAds']} ad(s) show")
        others = [u for u in view["adRequests"] if u != script]
        if others:
            problems.append(f"{engine} {key}: ads are off, but the page asked for {others}")
        if script not in view["adRequests"]:
            problems.append(f"{engine} {key}: Google's AdSense script for {view['adsPublisher']} is missing (Google needs it to check the site)")
        if not view.get("analytics"):
            problems.append(f"{engine} {key}: Cloudflare Web Analytics didn't load")
    print(f"{engine} ads off: ad files asked for: {report['pc-about'].get('adRequests')}")
    for size in ("phone", "pc"):
        for tab in ("profiles", "privacy"):
            check_nav(engine, size, tab, report[f"{size}-{tab}"].get("nav"))
        # Each page opened by its own address shows there, with its own title.
        titles = {tab: report[f"{size}-{tab}"].get("title") for tab in PATHS}
        print(f"{engine} {size} titles: {json.dumps(titles)}")
        for tab, path in PATHS.items():
            if report[f"{size}-{tab}"].get("address") != path:
                problems.append(f"{engine} {size} {tab}: opening {path} ends up at {report[f'{size}-{tab}'].get('address')}")
        if len(set(titles.values())) != len(PATHS) or not all(titles.values()):
            problems.append(f"{engine} {size}: the pages don't each have their own title ({titles})")

        def lands(view, tab):
            return (view or {}).get("path") == PATHS[tab] and not view.get("hash") \
                and view.get("shown") == f"page-{tab}" and view.get("title") == titles[tab]

        # getcounterlock.com/privacy/ is the Privacy & rules page.
        pa = report.get(f"{size}-privacyAddress", {})
        print(f"{engine} {size} /privacy/: {json.dumps(pa)}")
        top = pa.get("titleTop")
        if pa.get("landedOn") != "/privacy/" or pa.get("pageTitle") != titles["privacy"] or not pa.get("privacyShown") \
                or top is None or not 0 <= top < pa["viewportHeight"]:
            problems.append(f"{engine} {size}: /privacy/ isn't the Privacy & rules page ({pa})")
        # Old #links land on the new addresses.
        old = report.get(f"{size}-oldLinks", {})
        for link, tab in OLD_LINKS.items():
            print(f"{engine} {size} old link {link}: {json.dumps(old.get(link))}")
            if not lands(old.get(link), tab):
                problems.append(f"{engine} {size}: the old link {link} doesn't land on {PATHS[tab]} ({old.get(link)})")
        # Page switches Cloudflare Web Analytics counts: Download and Counter
        # Profiles (sidebar buttons), Privacy (its link), Back to Profiles,
        # Forward to Privacy. Then a reload stays on Privacy.
        an = report.get(f"{size}-analytics", {})
        print(f"{engine} {size} analytics page views: {json.dumps(an)}")
        if an.get("views") != ["/download/", "/profiles/", "/privacy/", "/profiles/", "/privacy/"]:
            problems.append(f"{engine} {size}: page switches aren't each counted as a page view of their own address ({an.get('views')})")
        for step, tab in (("afterBack", "profiles"), ("afterForward", "privacy"), ("afterReload", "privacy")):
            if not lands(an.get(step), tab):
                problems.append(f"{engine} {size}: {step} should show {PATHS[tab]} ({an.get(step)})")
    # The ad positions with ads switched on.
    for size in ("phone", "pc"):
        on = report.get(f"{size}-adsOn", {})
        for err in report.get(f"{size}-pageErrors", []) + on.get("pageErrors", []):
            problems.append(f"{engine} {size}: script error: {err}")
        if not on.get("switchedOn"):
            problems.append(f"{engine} {size}: couldn't switch ads on for the test (is SITE.ads in index.html?)")
            continue
        for key in ("about", "download-web", "download-win", "download-lin"):
            check_ad_box(engine, size, key, on.get(key, {}))
        if on.get("download-no-system", {}).get("shown"):
            problems.append(f"{engine} {size} download: the ad shows before a system is picked")
        for tab in ("profiles", "privacy"):
            if on.get(tab, {}).get("visibleAds"):
                problems.append(f"{engine} {size} {tab}: shows an ad")
    # A pull request that replaces the app screenshot changes that image on
    # purpose, so then compare with it covered: the rest must still match.
    old_report = json.loads((before / report_file.name).read_text())
    replaced = old_report["shotImage"] != report["shotImage"]
    name = f"{engine}-pc-about-masked.png" if replaced else f"{engine}-pc-about.png"
    old = Image.open(before / name).convert("RGB")
    new = Image.open(after / name).convert("RGB")
    note = " (app screenshot replaced, compared with it covered)" if replaced else ""
    # A pull request that changes the sidebar's menu changes the sidebar on
    # purpose: then compare the page content only.
    old_nav, new_nav = old_report["pc-about"].get("navLabels"), report["pc-about"].get("navLabels")
    old_drawn = [(n["label"], n["lines"], n["height"]) for n in old_report["pc-about"].get("nav") or []]
    new_drawn = [(n["label"], n["lines"], n["height"]) for n in report["pc-about"].get("nav") or []]
    if old_nav != new_nav or old_drawn != new_drawn:
        left = report["pc-about"]["sideRight"] * new.width // 1440
        old, new = old.crop((left, 0, old.width, old.height)), new.crop((left, 0, new.width, new.height))
        note += f" (sidebar menu changed from {old_drawn or old_nav} to {new_drawn or new_nav}, compared the content only)"
    changed = ImageChops.difference(old, new).getbbox()
    print(f"{engine} PC About page{note}: {'unchanged' if changed is None else f'changed in {changed}'}")
    if changed is not None:
        problems.append(f"{engine} PC About page changed in {changed}")

for report_file in sorted(after.glob("*-report.json")):
    check_counter_pages(report_file.name.split("-")[0], json.loads(report_file.read_text()))

if not list(after.glob("*-report.json")):
    problems.append("no reports found")
for problem in problems:
    print(f"::error::{problem}")
sys.exit(1 if problems else 0)
