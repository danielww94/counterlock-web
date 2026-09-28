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
  public publishable key) and `SITE` (contact and support emails, sponsors).
  Never change, remove or reformat them unless Daniel asks.
- `supabase.js` is the Supabase client the Counter Profiles library needs.
  Keep it next to `index.html`.
- Never add secrets. Everything in this repo is public.
- `app/` is the web version. It is generated from the private repo at deploy
  time by `.github/workflows/deploy-site.yml`. Never edit it by hand here; change
  the source in the private repo instead.
- Keep changes to `index.html` small and targeted. Don't restructure the page.
- Website text: short, plain, natural. No em dashes or en dashes.
- Version numbers and download links come from the GitHub releases API
  automatically; don't hardcode new versions.
- If the repo has tests, run them before opening a PR.
