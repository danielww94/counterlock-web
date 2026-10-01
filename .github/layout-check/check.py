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
"""

import json
import sys

MIN_GAP = 150  # px between an ad and the nearest button or download link
from pathlib import Path

from PIL import Image, ImageChops

before, after = Path(sys.argv[1]), Path(sys.argv[2])
problems = []

for report_file in sorted(after.glob("*-report.json")):
    engine = report_file.name.split("-")[0]
    report = json.loads(report_file.read_text())
    for tab in ("about", "download"):
        phone, pc = report[f"phone-{tab}"], report[f"pc-{tab}"]
        print(f"{engine} {tab}: phone sidebar {phone['sideHeight']} px, content starts "
              f"{phone['contentStartsAfterSidebar']} px after it; PC sidebar {pc['sideHeight']} px")
        if not 0 <= phone["contentStartsAfterSidebar"] <= 1:
            problems.append(f"{engine} phone {tab}: content starts {phone['contentStartsAfterSidebar']} px after the sidebar")
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
    print(f"{engine} ads off: ad files asked for: {report['pc-about'].get('adRequests')}")
    # The ad positions with ads switched on.
    for size in ("phone", "pc"):
        on = report.get(f"{size}-adsOn", {})
        for err in report.get(f"{size}-pageErrors", []) + on.get("pageErrors", []):
            problems.append(f"{engine} {size}: script error: {err}")
        if not on.get("switchedOn"):
            problems.append(f"{engine} {size}: couldn't switch ads on for the test (is SITE.ads in index.html?)")
            continue
        for key in ("about", "download-web", "download-win", "download-lin"):
            ad = on.get(key, {})
            print(f"{engine} {size} ad {key}: {json.dumps(ad)}")
            if not ad.get("shown"):
                problems.append(f"{engine} {size} {key}: the ad box doesn't show with ads on")
                continue
            if ad["adHeight"] != 250:
                problems.append(f"{engine} {size} {key}: {ad['adHeight']} px kept for the ad instead of 250")
            if ad["boxHeightBefore"] != ad["boxHeightAfter"]:
                problems.append(f"{engine} {size} {key}: the page jumps when the ad loads ({ad['boxHeightBefore']} to {ad['boxHeightAfter']} px)")
            if ad["inForm"]:
                problems.append(f"{engine} {size} {key}: the ad is inside a form or dialog")
            if ad["nearestControl"] < MIN_GAP:
                problems.append(f"{engine} {size} {key}: the ad is {ad['nearestControl']} px from {ad['nearestName']} (needs {MIN_GAP})")
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
    changed = ImageChops.difference(old, new).getbbox()
    note = " (app screenshot replaced, compared with it covered)" if replaced else ""
    print(f"{engine} PC About page{note}: {'unchanged' if changed is None else f'changed in {changed}'}")
    if changed is not None:
        problems.append(f"{engine} PC About page changed in {changed}")

if not list(after.glob("*-report.json")):
    problems.append("no reports found")
for problem in problems:
    print(f"::error::{problem}")
sys.exit(1 if problems else 0)
