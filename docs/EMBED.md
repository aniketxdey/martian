# Embedding the demo console

`npm run build:embed` builds a static copy of the console for the marketing site:

- no sign‑in, no API calls; the chat runs on the local planner in the browser
- a fixed seed (`20261026`) and the first company template, so every visitor sees the
  same world, which still moves in real time
- relative asset paths (`--base ./`) and hash routes, so it works from any sub‑path

```bash
npm run build:embed        # → dist-embed/
npm run preview:embed      # serves it on :4173 for a quick look
```

## Hosting under a sub‑path

Copy `dist-embed/` to the folder you want, for example `public/demo-app/` in the landing
page repo, and link to `/demo-app/` **with the trailing slash**; relative paths resolve
against it. Deep links use the hash, so `/demo-app/#/agents` or
`/demo-app/#/infrastructure` open a specific page.

Query parameters, placed before the hash:

| Param | Effect |
| --- | --- |
| `variant` | `1`–`5` or a template name (`northwind`, `helix`, `atlas`, `lumen`, `vertex`) |
| `seed` | any integer; same seed and variant give the same world |
| `embed=1` | turns any normal build into the embed experience (no sign‑in, demo ribbon) |

Example: `/demo-app/?variant=3#/agents`.

## In an iframe

```html
<iframe src="/demo-app/#/overview" title="Martian demo" style="width:100%;height:820px;border:0"></iframe>
```

The console follows the visitor's light or dark setting unless they pick one in
Settings → Appearance; that choice is stored per browser.
