"""Checks the screenshots and numbers from shots.cjs, for
.github/workflows/layout-check.yml. Usage: python check.py <before> <after>

- Phone (393x852): the page content starts right after the sidebar.
- PC (1440x900): the sidebar is the full window height, the content starts
  at the top, and the About page looks exactly as it did before (pixel for
  pixel), in every engine.
"""

import json
import sys
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
    old = Image.open(before / f"{engine}-pc-about.png").convert("RGB")
    new = Image.open(after / f"{engine}-pc-about.png").convert("RGB")
    changed = ImageChops.difference(old, new).getbbox()
    print(f"{engine} PC About page: {'unchanged' if changed is None else f'changed in {changed}'}")
    if changed is not None:
        problems.append(f"{engine} PC About page changed in {changed}")

if not list(after.glob("*-report.json")):
    problems.append("no reports found")
for problem in problems:
    print(f"::error::{problem}")
sys.exit(1 if problems else 0)
