---
name: cf-drop
description: Deploy a folder or zip to Cloudflare Drop from the CLI — no account needed, live on workers.dev in seconds, expires in 60 minutes unless claimed. Use when the user wants to quickly deploy/share/preview a static site, or mentions "cf-drop", "Cloudflare Drop", "temporary deploy", "临时部署", "快速分享静态页面", "丢到公网看看".
---

# cf-drop — Deploy to Cloudflare Drop

## Quick start

```bash
npx cf-drop <folder-or-zip>          # human-readable output
npx cf-drop <folder-or-zip> --json   # JSON output for scripting
```

A successful deploy returns three things — always relay all of them to the user:

- **site**: the live URL (`https://drop-xxx.yyy.workers.dev`)
- **claim**: claim link (claim into a Cloudflare account within 60 min to keep the site)
- **expires**: expiry timestamp

## Pre-flight checks (do these BEFORE deploying)

1. **Deployments are PUBLIC.** Scan the target directory first — make sure there are no `.env` files, keys, or private data. The CLI skips dotfiles and `node_modules` automatically, but nothing else.
2. `index.html` should exist at the root (the CLI warns if missing; the site will likely 404 without it).
3. Total size ≤ 100MB, static assets only (HTML/CSS/JS/images/fonts).
4. Uploading a user's directory is data egress. If a permission check blocks the command, do NOT work around it — ask the user to run it themselves or approve the prompt.

## Troubleshooting

- **`curl` on the deployed site returns "Just a moment..."**: that's Cloudflare's bot challenge blocking non-browser traffic — expected. The site works fine in a browser; trust the CLI output as proof of a successful deploy.
- **Deploy fails with 4xx**: temporary credentials / PoW challenges are short-lived — just rerun the command.
- Project: https://github.com/limboinf/cf-drop
