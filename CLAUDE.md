# counterlock-web (public website repo)

This repo is the website `https://getcounterlock.com`, served by GitHub Pages,
and it hosts the Counterlock releases (Windows `.exe`, Linux binary, and
`Counterlock-web.zip` for the web version). The app's source lives in the
private repo `danielww94/counterlock`; see its `CLAUDE.md`.

The owner (Daniel) is not a web developer. Explain anything he has to do by
hand in short numbered steps.

## Rules

- `index.html` has three live settings blocks at the top: `RELEASE` (GitHub
  repo, fallback version, release file names), `SUPABASE` (project URL and the
  public publishable key) and `SITE` (contact and support emails, sponsors,
  Google AdSense ads). Never change, remove or reformat them unless Daniel asks.
- Google AdSense: the AdSense script in `<head>` and `ads.txt` (site root)
  stay as they are, so Google can check the site. Ads only ever go in the
  prepared positions on the main site (About, Download, one per counter
  page), each with its own `SITE.adSlots` entry, a 250 px box and an
  "Advertisement" label, hidden while `SITE.ads` is 'off'. Never in `app/`,
  never near download buttons, other buttons or links, and never inside
  forms or dialogs.
- `supabase.js` is the Supabase client the Counter Profiles library needs.
  Keep it next to `index.html`.
- Never add secrets. Everything in this repo is public.
- `app/` is the web version. It is generated from the private repo at deploy
  time by `.github/workflows/deploy-site.yml` (unpacked from
  `Counterlock-web.zip` in the latest published release). Never edit it by hand
  here; change the source in the private repo instead.
- Pages publishes through that workflow (Settings > Pages > Source: GitHub
  Actions), so the site is exactly the repo's files (minus `.github`,
  `README.md`, `CLAUDE.md`) plus `app/`, put together by
  `.github/build-site.sh`.
- Every page has its own address (`/`, `/download/`, `/profiles/`,
  `/privacy/`, `/counter/`, `/counter/<hero>/`), so Cloudflare Web Analytics
  counts them apart. The folders are
  copies of `index.html` made by `build-site.sh` at deploy time; never commit
  them. Links between pages use those paths, not `#links` (old `#links` still
  land on the new address). AdSense's consent message links to `/privacy/`.
- The counter pages (`/counter/` and one per enemy hero), `404.html` and
  `sitemap.xml` are made at deploy time by `.github/build-pages.py` from the
  counter profile in the latest release's `Counterlock-web.zip`, read with
  the app's own Python. Never commit them or write them by hand: to change
  their text, change the profile in the private repo; to change their look
  or layout, change `build-pages.py` (they take the styles, sidebar,
  settings block, AdSense script and analytics snippet from `index.html`).
  The same script gives each copy of `index.html` its own title,
  description and canonical address. `og-image.png` is the link preview
  picture (1200x630) and `robots.txt` points to the sitemap.
- Pages publishes a given commit only once: deploying the same commit again
  reports success but keeps the old files. So on a release or "Run workflow",
  `deploy-site.yml` first commits `.github/live-release.txt` to `main` and
  deploys that new commit. Don't edit that file, and don't replace this with
  a re-run of an old run.
- Keep changes to `index.html` small and targeted. Don't restructure the page.
- Website text: short, plain, natural. No em dashes or en dashes.
- Version numbers and download links come from the GitHub releases API
  automatically; don't hardcode new versions.
- If the repo has tests, run them before opening a PR. The layout check
  (`.github/layout-check/`) runs on GitHub for pull requests; locally it
  needs Node.js, Playwright and Pillow (see `layout-check.yml`).
