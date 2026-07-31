# Anvil

Personal training log. StrongLifts 5x5, rower, kettlebell, barbell, dumbbell, body.

**Live:** https://svendoldenburg.com/anvil/
Formerly `training-tracker` (renamed 2026-07-31).

## Stack

- Vanilla JS ES modules, no framework, no build step. GitHub Pages off `master`.
- PocketBase (v0.37) at `pb.aetheriumforge.cloud` for all data.
- Auth: the shared `users` collection, same account as Vessel and Lumen.
- PWA: `manifest.json` + `sw.js` app-shell cache.

## Deploy

Push to `master`. GitHub Pages picks it up.

**Bump `CACHE` in `sw.js` on any frontend change.** The app shell is cached
cache-first; without a bump, returning visitors keep the old shell. This is not
theoretical: the cache sat at `train-v1` from 2026-04-29 to 2026-07-31 while the
whole data layer was rewritten underneath it.

## Collections

`strength_sessions`, `rower_sessions`, `kettlebell_sessions`, `barbell_sessions`,
`dumbbell_sessions`, `bodyweight`, `body_measurements`.

**They are deliberately not prefixed `anvil_*`,** unlike `vessel_*` / `lumen_*` /
`meeple_*`. Renaming a PocketBase collection changes its API path, so it would
have to be atomic with a frontend push. Not worth a guaranteed broken window on a
box scheduled for a destructive reinstall. Revisit after the Frankfurt move.

All five rules on all seven are `@request.auth.collectionName = "users"`, which
also keeps a `meeple_users` token out. Set and checked by `tools/`.

## Gotchas

- **Sort by `session_date`, never `created`.** A `created` sort returns 400 on
  this PocketBase version.
- Empty PocketBase number fields come back as `0`, not `null`.
- The app maps its own `date` field to PocketBase's `session_date` in `js/api.js`.

## Known offline gaps

The app shell works offline; the data does not (by design, PocketBase is the only
store). Two things additionally will not render offline:

- **Progress charts.** `js/views/history.js` and `js/views/body.js` import Chart.js
  from jsdelivr at runtime. Cross-origin, so the service worker skips it.
- **Fonts.** IBM Plex Sans and JetBrains Mono come from Google Fonts. The system
  fallback takes over.

Both are fixable by vendoring; neither is worth it yet.

## Tools

```
python tools/gen_icons.py        # regenerate icons/ (pure stdlib, ~3 min)
python tools/set_rules.py        # tighten collection rules (idempotent)
python tools/verify_access.py    # prove the lockdown holds
```

Copy `tools/.env.example` to `tools/.env` first.

## MCP server

`mcp/` is a local stdio MCP server so Claude can query the training history in
conversation. See `mcp/README.md`.

## Dev

```
python -m http.server 8000
```

Then `http://localhost:8000/?preview` to bypass the login screen.
