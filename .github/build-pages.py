#!/usr/bin/env python3
"""Makes the generated parts of the site, for .github/build-site.sh.
Usage: python3 build-pages.py <repo folder> <site folder>

<site folder> already holds the repo's files, the copies of index.html
(download/, profiles/, privacy/) and, when the release had one, the web
version in app/. This script adds:

  - Search details for each copy of index.html: its own title, description,
    canonical address and share preview (Open Graph, X), and the
    SoftwareApplication details only on / and /download/.
  - The counter pages: /counter/ (every hero, A to Z) and one page per enemy
    hero at /counter/<hero>/, made from the counter profile inside app/, the
    same profile the web version starts with. They read it with the app's own
    Python (app/core.zip), so they always match the app and update with every
    release. No release with the web version: no counter pages.
  - /404.html, the page GitHub Pages shows for an unknown address.
  - /sitemap.xml with every page (robots.txt points to it).

The counter pages and 404.html take their look from index.html, so nothing is
copied by hand: the styles (written once to /counter/site.css), the sidebar,
the settings block at the top (SITE.palette, SITE.ads, SITE.adSlots.counter),
the AdSense script and the Cloudflare Web Analytics snippet.
"""

from __future__ import annotations

import datetime
import html
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

SITE_URL = "https://getcounterlock.com"
PREVIEW_IMAGE = f"{SITE_URL}/og-image.png"
# The copies of index.html (build-site.sh) and what search engines show for
# them. Titles come from pageTitle in index.html, so the tab title and the
# search result always agree.
PAGE_DESCRIPTIONS = {
    "download": "Download Counterlock for Windows or Linux, or open it in your browser. "
                "One file, no installer, free. See the counter items for every Deadlock hero.",
    "profiles": "Counter profiles for Counterlock, shared by players. Download one to get "
                "different counter items and tips for Deadlock, or upload your own.",
    "privacy": "How Counterlock and getcounterlock.com handle your data, cookies and ads, "
               "and the rules for profiles shared in the Counter Profiles library.",
}
PAGE_PATHS = {"about": "/", "download": "/download/", "profiles": "/profiles/", "privacy": "/privacy/"}
TIPS_OPEN_LIMIT = 4  # more heroes with tips than this: each hero's tips fold away

esc = html.escape


def fail(message: str) -> None:
    print(f"::error::build-pages.py: {message}")
    sys.exit(1)


def take(pattern: str, text: str, what: str) -> str:
    found = re.search(pattern, text, re.S)
    if not found:
        fail(f"couldn't find {what} in index.html")
    return found.group(0)


# --- the parts of index.html the generated pages reuse -------------------------

class Site:
    def __init__(self, index: str) -> None:
        self.index = index
        self.settings = take(r"<script>\s*const RELEASE = \{.*?</script>", index, "the settings block")
        self.adsense = take(r'<script async src="https://pagead2\.googlesyndication\.com/[^"]*"[^>]*></script>',
                            index, "the AdSense script")
        self.analytics = take(r"<!-- Cloudflare Web Analytics --><script.*?<!-- End Cloudflare Web Analytics -->",
                              index, "the Cloudflare Web Analytics snippet")
        self.css = take(r"<style>.*?</style>", index, "the styles")[len("<style>"):-len("</style>")]
        self.aside = take(r'<aside class="side">.*?</aside>', index, "the sidebar")
        self.favicon = take(r'<link rel="icon"[^>]*>', index, "the favicon")
        self.theme = take(r'<meta name="theme-color"[^>]*>', index, "the theme colour")
        titles = take(r"const pageTitle = \{.*?\};", index, "pageTitle")
        self.titles = dict(re.findall(r"(\w+):\s*'([^']*)'", titles))
        self.titles["about"] = html.unescape(take(r"<title>.*?</title>", index, "the title")[7:-8])

    def sidebar(self, current: str, version: str) -> str:
        """The sidebar with links instead of the page buttons (these pages
        are plain HTML), `current` marked as the open page."""
        aside = re.sub(
            r'<button class="navitem" data-nav="(\w+)"[^>]*>(.*?)</button>',
            lambda m: f'<a class="navitem" href="{PAGE_PATHS[m.group(1)]}">{m.group(2)}</a>', self.aside)
        aside = aside.replace(f'<a class="navitem" href="{current}">', f'<a class="navitem" href="{current}" aria-current="page">')
        aside = aside.replace('<a href="/" data-jump="help">', '<a href="/#help">')
        if version:
            aside = re.sub(r'(<span class="v" id="ver">)[^<]*', rf"\g<1>v{version}", aside)
        return aside


# --- search details for the copies of index.html -------------------------------

def set_tag(text: str, pattern: str, value: str) -> str:
    """Puts `value` into the content/href of the first tag matching `pattern`."""
    value = esc(value, quote=False).replace('"', "&quot;")
    return re.sub(pattern, lambda m: m.group(1) + value + m.group(2), text, count=1)


def page_head(text: str, path: str, title: str, description: str, keep_app_details: bool, version: str) -> str:
    text = re.sub(r"<title>.*?</title>", lambda m: f"<title>{esc(title, quote=False)}</title>", text, count=1)
    text = set_tag(text, r'(<meta name="description" content=")[^"]*(")', description)
    text = set_tag(text, r'(<link rel="canonical" href=")[^"]*(")', SITE_URL + path)
    text = set_tag(text, r'(<meta property="og:url" content=")[^"]*(")', SITE_URL + path)
    text = set_tag(text, r'(<meta property="og:title" content=")[^"]*(")', title)
    text = set_tag(text, r'(<meta property="og:description" content=")[^"]*(")', description)
    app = re.compile(r'(<script type="application/ld\+json" id="ld-app">)(.*?)(</script>)', re.S)
    if not keep_app_details:
        return app.sub("", text)
    if version:
        def with_version(m: re.Match) -> str:
            data = json.loads(m.group(2))
            data["softwareVersion"] = version
            return m.group(1) + json.dumps(data, ensure_ascii=False) + m.group(3)
        text = app.sub(with_version, text)
    return text


def tag_pages(site_dir: Path, site: Site, version: str) -> None:
    home = site_dir / "index.html"
    found = re.search(r'<meta name="description" content="([^"]*)"', site.index)
    description = html.unescape(found.group(1)) if found else ""
    home.write_text(page_head(home.read_text(encoding="utf-8"), "/", site.titles["about"], description, True, version),
                    encoding="utf-8")
    for name, description in PAGE_DESCRIPTIONS.items():
        page = site_dir / name / "index.html"
        if page.is_file():
            title = site.titles.get(name, "Counterlock")
            page.write_text(page_head(page.read_text(encoding="utf-8"), PAGE_PATHS[name], title, description,
                                      name == "download", version), encoding="utf-8")


# --- the counter profile, read with the app's own code -------------------------

def load_app_profile(app_dir: Path):
    """The profile the web version starts with, and the app's phase labels."""
    core = app_dir / "core.zip"
    if not core.is_file():
        return None
    sys.path.insert(0, str(core))
    try:
        from counterlock.profile_io import load_profile_text
        from counterlock.profile_updates import BUNDLED_PROFILE_NAME
        try:
            from counterlock.core.render import PHASES
        except ImportError:
            PHASES = (("Lane phase", ""), ("Mid game", ""), ("Late game", ""))
    except Exception as exc:  # noqa: BLE001 - any problem: say so, publish without counter pages
        print(f"::warning::Couldn't read the app's Python in {core} ({exc}), so there are no counter pages.")
        return None
    with zipfile.ZipFile(core) as zf:
        name = f"profiles/{BUNDLED_PROFILE_NAME}"
        data = zf.read(name) if name in zf.namelist() else (app_dir / name).read_bytes()
    return load_profile_text(data, BUNDLED_PROFILE_NAME), PHASES


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", (text or "").strip()) if s]


def first_sentence(text: str) -> str:
    found = sentences(text)
    return found[0] if found else ""


def clip(text: str, limit: int) -> str:
    """Text cut at a word to at most `limit` characters, with … when cut."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def slug(hero_id: str) -> str:
    return hero_id.replace("_", "-")


def iso_date(text: str) -> str:
    try:
        return datetime.date.fromisoformat((text or "").strip()).isoformat()
    except ValueError:
        return ""


# --- page building blocks --------------------------------------------------------

def head(site: Site, *, title: str, description: str, path: str, og_type: str = "website",
         json_ld: dict | None = None, ads: bool = False, noindex: bool = False) -> str:
    canonical = SITE_URL + path
    attr = lambda s: esc(s, quote=True)
    parts = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8" />',
        "<!-- Made by .github/build-pages.py at deploy time. Don't edit the copy on the site;",
        "     the text comes from the counter profile, the look and settings from index.html. -->",
        site.settings,
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        f"<title>{esc(title, quote=False)}</title>",
        f'<meta name="description" content="{attr(description)}" />',
    ]
    if noindex:
        parts.append('<meta name="robots" content="noindex" />')
    else:
        parts += [
            f'<link rel="canonical" href="{attr(canonical)}" />',
            f'<meta property="og:type" content="{og_type}" />',
            '<meta property="og:site_name" content="Counterlock" />',
            f'<meta property="og:title" content="{attr(title)}" />',
            f'<meta property="og:description" content="{attr(description)}" />',
            f'<meta property="og:url" content="{attr(canonical)}" />',
            f'<meta property="og:image" content="{PREVIEW_IMAGE}" />',
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            '<meta property="og:image:alt" content="Counterlock showing the counter items for an enemy hero in Deadlock" />',
            '<meta name="twitter:card" content="summary_large_image" />',
        ]
    parts += [site.theme, site.favicon]
    if ads:
        parts.append(site.adsense)
    parts += [site.analytics, '<link rel="stylesheet" href="/counter/site.css" />']
    if json_ld:
        parts.append('<script type="application/ld+json">' + json.dumps(json_ld, ensure_ascii=False).replace("</", "<\\/") + "</script>")
    parts += ["</head>", "<body>", '<div class="shell">']
    return "\n".join(parts)


def foot() -> str:
    return "\n".join(["  </main>", "</div>", "</body>", "</html>", ""])


def breadcrumbs(trail: list[tuple[str, str]]) -> tuple[str, dict]:
    """The visible breadcrumb links and the matching BreadcrumbList data."""
    items = []
    for n, (name, path) in enumerate(trail):
        if n == len(trail) - 1:
            items.append(f'<li><span aria-current="page">{esc(name)}</span></li>')
        else:
            items.append(f'<li><a href="{path}">{esc(name)}</a></li>')
    markup = '<nav class="crumbs" aria-label="Breadcrumb"><ol>' + "".join(items) + "</ol></nav>"
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": n + 1, "name": name, "item": SITE_URL + path}
                            for n, (name, path) in enumerate(trail)],
    }
    return markup, data


def enemy_heroes(profile) -> list:
    """Every enemy with a counter page, A to Z by name. Not grouped by type:
    a hero's type depends on the build (the app lets you pick one per matchup)."""
    return sorted((h for h in profile.heroes.values() if h.hero_id in profile.enemies), key=lambda h: h.name.lower())


def hero_list(profile, current: str = "") -> str:
    """Links to every enemy's counter page, A to Z."""
    links = []
    for h in enemy_heroes(profile):
        mark = ' aria-current="page"' if h.hero_id == current else ""
        links.append(f'<li><a href="/counter/{slug(h.hero_id)}/"{mark}>{esc(h.name)}</a></li>')
    return f'<ul class="hero-links">{"".join(links)}</ul>'


COUNTER_CSS = """
/* ---------------- Counter pages and 404 (.github/build-pages.py) ---------------- */
.crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:4px 8px;padding:0;margin:0 0 18px;font-size:13px;color:var(--bone-dim)}
.crumbs li+li::before{content:"/";margin-right:8px;opacity:.6}
.crumbs a{color:var(--bone-dim);text-decoration:none;border-bottom:1px solid var(--line)}
.crumbs a:hover{color:var(--iris)}
.updated{font-size:13px;color:var(--bone-dim);margin:-22px 0 26px}
.quick{border:1px solid var(--iris-deep);background:var(--ink-2);padding:20px 24px;max-width:680px;margin:6px 0 0}
.quick .label{font-family:var(--cond);text-transform:uppercase;letter-spacing:.06em;font-size:13px;color:var(--orchid);margin:0 0 8px}
.quick p{margin:0 0 12px;font-size:16px;color:var(--bone)}
.quick ol{margin:0 0 20px;padding-left:22px;max-width:62ch}
.quick li{margin:0 0 8px;font-size:15px;color:var(--bone)}
.quick li .when{color:var(--bone-dim)}
.quick .actions{display:flex;flex-wrap:wrap;align-items:center;gap:14px 20px}
.quick .btn{display:inline-block;text-decoration:none;font-size:14px;padding:11px 18px}
.text{font-size:15.5px;color:var(--bone);margin:0 0 10px}
.time{font-family:var(--sans);text-transform:none;letter-spacing:0;font-weight:400;color:var(--bone-dim);font-size:13px;margin-left:8px}
.items{list-style:none;padding:0;margin:0;max-width:70ch}
.items li{padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:15px;color:var(--bone-dim)}
.items li:last-child{border-bottom:0}
.items b{color:var(--bone);font-weight:600}
.tips-list{max-width:680px}
.tips-list ul{margin:0;padding:0 18px 12px 36px}
.tips-list li{font-size:15px;color:var(--bone);margin:0 0 6px}
.tips-list details{border:1px solid var(--line);margin:0 0 8px}
.tips-list summary{cursor:pointer;padding:10px 16px;font-family:var(--cond);text-transform:uppercase;letter-spacing:.03em;font-size:16px;color:var(--bone)}
.tips-list summary:hover{color:var(--iris)}
.tips-list summary:focus-visible{outline:2px solid var(--iris);outline-offset:-2px}
.tips-list .vs{padding:0 18px 14px 36px;margin:0;font-size:14px}
.tips-list h3{font-family:var(--cond);text-transform:uppercase;letter-spacing:.03em;font-weight:600;font-size:16px;margin:14px 0 6px}
.tips-list .open ul{padding:0 0 4px 20px}
.hero-links{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0;max-width:760px}
.hero-links a{display:inline-block;border:1px solid var(--line);padding:6px 12px;font-size:14px;color:var(--bone);text-decoration:none;transition:border-color .15s ease,color .15s ease}
.hero-links a:hover,.hero-links a[aria-current]{border-color:var(--iris);color:var(--iris)}
.hero-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;list-style:none;padding:0;margin:0;max-width:860px}
.hero-cards a{display:block;height:100%;border:1px solid var(--line);background:var(--ink-2);padding:12px 16px;color:var(--bone);text-decoration:none;transition:border-color .15s ease}
.hero-cards a:hover{border-color:var(--iris)}
.hero-cards b{display:block;font-family:var(--cond);text-transform:uppercase;letter-spacing:.02em;font-weight:600;font-size:18px}
.hero-cards small{display:block;color:var(--bone-dim);font-size:13px;line-height:1.5;margin-top:3px}
.lost-links{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0 0}
.lost-links .btn{display:inline-block;text-decoration:none;font-size:14px;padding:11px 18px}
@media (max-width:820px){
  .quick{padding:18px}
  .tips-list ul,.tips-list .vs{padding-left:30px}
}
"""

# Shows the counter page's ad position, like showAds() in index.html: only
# while SITE.ads is 'on' and SITE.adSlots.counter holds an ad unit ID.
PAGE_SCRIPT = """<script>
(function(){
  const cfg = (typeof SITE !== 'undefined' && SITE) || {};
  const sponsor = String(cfg.githubSponsors || '').trim();
  const side = document.getElementById('ghSponsorsSide');
  if (side && /^[A-Za-z0-9-]{1,39}$/.test(sponsor)) { side.href = 'https://github.com/sponsors/' + sponsor; side.hidden = false; }
  const pub = String(cfg.adsPublisher || '').trim();
  const slot = String((cfg.adSlots || {}).counter || '').trim();
  const box = document.querySelector('.ad-slot[data-ad="counter"]');
  if (cfg.ads !== 'on' || !/^ca-pub-\\d+$/.test(pub) || !box || !/^\\d+$/.test(slot)) return;
  box.hidden = false;
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.dataset.adClient = pub;
  ins.dataset.adSlot = slot;
  box.appendChild(ins);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ad blocked: the box stays empty */ }
})();
</script>"""


def updated_line(profile) -> str:
    bits = []
    if profile.patch:
        bits.append(f"Updated for patch {esc(profile.patch)}.")
    if iso_date(profile.date):
        bits.append(f"Counter profile from {esc(profile.date)}.")
    return f'<p class="updated">{" ".join(bits)}</p>' if bits else ""


def top_items(enemy) -> list[tuple[str, object]]:
    """The 3 most important counters: the profile lists each phase's items
    most important first, so the first of lane, mid and late, filled up from
    the next ones when a phase is empty."""
    phases = [("Lane", enemy.lane), ("Mid game", enemy.mid), ("Late game", enemy.late)]
    picks = [(label, items[0]) for label, items in phases if items]
    depth = 1
    while len(picks) < 3 and any(len(items) > depth for _l, items in phases):
        picks += [(label, items[depth]) for label, items in phases if len(items) > depth][:3 - len(picks)]
        depth += 1
    return picks[:3]


def counter_page(site: Site, profile, phases, hero, version: str) -> str:
    e = profile.enemies[hero.hero_id]
    name = hero.name
    path = f"/counter/{slug(hero.hero_id)}/"
    title = f"How to counter {name} in Deadlock"
    description = clip(f"How to counter {name} in Deadlock. {e.threat_profile or e.key_principle}", 158)
    crumbs, crumb_data = breadcrumbs([("Home", "/"), ("Counters", "/counter/"), (name, path)])
    out = [head(site, title=f"{title} · Counterlock", description=description, path=path,
                og_type="article", json_ld=crumb_data, ads=True)]
    out.append(site.sidebar("/counter/", version))
    out.append("  <main>")
    out.append('    <section class="page active" aria-labelledby="t-hero">')
    out.append("      " + crumbs)
    out.append(f'      <h1 class="title" id="t-hero">{esc(title)}</h1>')
    kind = f"{hero.type_label} hero. " if hero.type_label else ""
    out.append(f'      <p class="lede">{esc(kind)}Counter items for lane, mid and late game, and tips for the hero you play.</p>')
    out.append("      " + updated_line(profile))

    # Quick answer: the threat in one sentence and the 3 most important items.
    threat = first_sentence(e.key_principle) or first_sentence(e.threat_profile)
    out.append('      <div class="quick">')
    out.append('        <p class="label">Quick answer</p>')
    if threat:
        out.append(f"        <p>{esc(threat)}</p>")
    picks = top_items(e)
    if picks:
        out.append("        <ol>")
        for label, item in picks:
            note = first_sentence(item.note)
            out.append(f'          <li><b>{esc(item.name)}</b> <span class="when">({esc(label.lower())})</span>'
                       + (f" {esc(note)}" if note else "") + "</li>")
        out.append("        </ol>")
    out.append('        <div class="actions">')
    out.append(f'          <a class="btn primary" href="/app/?enemy={esc(hero.hero_id)}">Open {esc(name)} in the Counterlock web app</a>')
    out.append('          <a class="inline-link" href="/download/">Download Counterlock</a>')
    out.append("        </div>")
    out.append("      </div>")

    if e.threat_profile:
        out.append('      <h2 class="sec">Threat profile</h2>')
        out.append(f'      <p class="text">{esc(e.threat_profile)}</p>')
    if e.key_principle:
        out.append('      <h2 class="sec">Key principle</h2>')
        out.append(f'      <p class="text">{esc(e.key_principle)}</p>')
    if e.note:
        out.append(f'      <div class="callout">{esc(e.note)}</div>')

    for n, ((label, time_range), items) in enumerate(zip(phases, (e.lane, e.mid, e.late))):
        if n == 2:
            # The ad position: between the item lists, far from every link
            # and button. Hidden unless SITE.ads is 'on' (see the script).
            out.append('      <div class="ad-slot" data-ad="counter" hidden><p class="ad-label">Advertisement</p></div>')
        if not items:
            continue
        time = f'<span class="time">{esc(time_range)}</span>' if time_range else ""
        out.append(f'      <h2 class="sec">{esc(label)} items{time}</h2>')
        out.append('      <ul class="items">')
        for item in items:
            note = f" {esc(item.note)}" if item.note else ""
            out.append(f"        <li><b>{esc(item.name)}</b>{note}</li>")
        out.append("      </ul>")

    if e.patch_note:
        out.append('      <h2 class="sec">Patch note</h2>')
        out.append(f'      <p class="text">{esc(e.patch_note)}</p>')

    tips = [(profile.heroes[h], lines) for h, lines in e.tips.items() if h in profile.heroes and lines]
    tips.sort(key=lambda t: t[0].name.lower())
    if tips:
        out.append(f'      <h2 class="sec">Tips for your hero against {esc(name)}</h2>')
        out.append('      <div class="tips-list">')
        fold = len(tips) > TIPS_OPEN_LIMIT
        for you, lines in tips:
            items = "".join(f"<li>{esc(t)}</li>" for t in lines)
            if fold:
                out.append(f"        <details><summary>{esc(you.name)}</summary><ul>{items}</ul>"
                           f'<p class="vs"><a class="inline-link" href="/app/?enemy={esc(hero.hero_id)}&amp;you={esc(you.hero_id)}">'
                           f"Open {esc(you.name)} against {esc(name)} in the web app</a></p></details>")
            else:
                out.append(f'        <div class="open"><h3>{esc(you.name)}</h3><ul>{items}</ul></div>')
        out.append("      </div>")

    out.append('      <h2 class="sec">Browse all heroes</h2>')
    out.append("      " + hero_list(profile, hero.hero_id))
    out.append("    </section>")
    out.append(PAGE_SCRIPT)
    out.append(foot())
    return "\n".join(out)


def counter_index(site: Site, profile, version: str) -> str:
    path = "/counter/"
    title = "Deadlock counters for every hero"
    description = clip(f"How to counter every hero in Deadlock: counter items for lane, mid and late game, "
                       f"key principles and tips for your hero. Updated for patch {profile.patch}."
                       if profile.patch else
                       "How to counter every hero in Deadlock: counter items for lane, mid and late game, "
                       "key principles and tips for your hero.", 158)
    crumbs, crumb_data = breadcrumbs([("Home", "/"), ("Counters", path)])
    out = [head(site, title=f"{title} · Counterlock", description=description, path=path, json_ld=crumb_data)]
    out.append(site.sidebar(path, version))
    out.append("  <main>")
    out.append('    <section class="page active" aria-labelledby="t-counters">')
    out.append("      " + crumbs)
    out.append(f'      <h1 class="title" id="t-counters">{esc(title)}</h1>')
    out.append('      <p class="lede">Pick the hero you are up against to see what to buy in lane, mid and late game, '
               'and how to play the matchup.</p>')
    out.append("      " + updated_line(profile))
    out.append('      <ul class="hero-cards">')
    for h in enemy_heroes(profile):
        e = profile.enemies[h.hero_id]
        line = first_sentence(e.key_principle) or first_sentence(e.threat_profile)
        out.append(f'        <li><a href="/counter/{slug(h.hero_id)}/"><b>{esc(h.name)}</b>'
                   + (f"<small>{esc(line)}</small>" if line else "") + "</a></li>")
    out.append("      </ul>")
    out.append('      <div class="callout">The same counters are in the Counterlock app, on your PC or in your '
               'browser, where you can also pick your own hero and edit the profile. '
               '<a class="inline-link" href="/download/">Get Counterlock</a></div>')
    out.append("    </section>")
    out.append(PAGE_SCRIPT)
    out.append(foot())
    return "\n".join(out)


def not_found_page(site: Site, version: str, has_counters: bool) -> str:
    out = [head(site, title="Page not found · Counterlock",
                description="This page doesn't exist on getcounterlock.com.", path="/404.html", noindex=True)]
    out.append(site.sidebar("", version))
    out.append("  <main>")
    out.append('    <section class="page active" aria-labelledby="t-lost">')
    out.append('      <h1 class="title" id="t-lost">Page not found</h1>')
    out.append('      <p class="lede">There is nothing at this address. It may have moved, or the link has a typo.</p>')
    out.append('      <div class="prose"><p>Try one of these instead:</p></div>')
    out.append('      <div class="lost-links">')
    out.append('        <a class="btn primary" href="/">Home</a>')
    if has_counters:
        out.append('        <a class="btn" href="/counter/">Hero counters</a>')
    out.append('        <a class="btn" href="/download/">Download</a>')
    out.append("      </div>")
    out.append("    </section>")
    out.append(PAGE_SCRIPT)
    out.append(foot())
    return "\n".join(out)


# --- sitemap ----------------------------------------------------------------------

def last_commit_date(repo: Path, *paths: str) -> str:
    try:
        done = subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%cs", "--", *paths],
                              capture_output=True, text=True, timeout=30)
        return iso_date(done.stdout)
    except (OSError, subprocess.SubprocessError):
        return ""


def sitemap(entries: list[tuple[str, str]]) -> str:
    rows = "".join(f"  <url><loc>{esc(SITE_URL + path)}</loc>" + (f"<lastmod>{d}</lastmod>" if d else "") + "</url>\n"
                   for path, d in entries)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "</urlset>\n")


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: build-pages.py <repo folder> <site folder>")
    repo, site_dir = Path(sys.argv[1]), Path(sys.argv[2])
    site = Site((repo / "index.html").read_text(encoding="utf-8"))
    app_dir = site_dir / "app"
    version = ""
    if (app_dir / "version.json").is_file():
        version = json.loads((app_dir / "version.json").read_text(encoding="utf-8")).get("version", "")

    today = datetime.date.today().isoformat()
    site_date = last_commit_date(repo, "index.html") or today
    pages_date = max(site_date, last_commit_date(repo, ".github/build-pages.py") or site_date)

    tag_pages(site_dir, site, version)

    counter_dir = site_dir / "counter"
    counter_dir.mkdir(exist_ok=True)
    (counter_dir / "site.css").write_text(site.css.strip() + "\n" + COUNTER_CSS, encoding="utf-8")

    entries = [(PAGE_PATHS[p], site_date) for p in ("about", "download", "profiles", "privacy")]
    loaded = load_app_profile(app_dir)
    if loaded:
        profile, phases = loaded
        counter_date = max(iso_date(profile.date) or pages_date, pages_date)
        heroes = enemy_heroes(profile)
        (counter_dir / "index.html").write_text(counter_index(site, profile, version), encoding="utf-8")
        entries.append(("/counter/", counter_date))
        for hero in heroes:
            folder = counter_dir / slug(hero.hero_id)
            folder.mkdir(exist_ok=True)
            (folder / "index.html").write_text(counter_page(site, profile, phases, hero, version), encoding="utf-8")
            entries.append((f"/counter/{slug(hero.hero_id)}/", counter_date))
        print(f"Counter pages: /counter/ and {len(heroes)} heroes, from {profile.name} (patch {profile.patch}, {profile.date}).")
    else:
        print("::warning::No web version in app/, so the site has no counter pages this time.")
    if (app_dir / "index.html").is_file():
        app_date = datetime.date.fromtimestamp((app_dir / "version.json").stat().st_mtime).isoformat() \
            if (app_dir / "version.json").is_file() else ""
        entries.append(("/app/", app_date))

    (site_dir / "404.html").write_text(not_found_page(site, version, bool(loaded)), encoding="utf-8")
    (site_dir / "sitemap.xml").write_text(sitemap(entries), encoding="utf-8")
    print(f"sitemap.xml: {len(entries)} addresses.")


if __name__ == "__main__":
    main()
