# cf-drop

**English** | [中文](#中文)

Upload a folder or zip to [Cloudflare Drop](https://www.cloudflare.com/drop/) from the command line — **no account needed**, your site is live on `workers.dev` in seconds and stays up for 60 minutes (claim it into a Cloudflare account to keep it).

> Unofficial tool. The deploy protocol was reverse-engineered from the Cloudflare Drop web app. By using it you accept [Cloudflare's Terms of Service](https://www.cloudflare.com/terms/) and [Privacy Policy](https://www.cloudflare.com/privacypolicy/) — the same terms the web UI asks you to accept.

## Usage

```bash
npx cf-drop ./dist          # deploy a folder
npx cf-drop site.zip        # deploy a zip
npx cf-drop ./dist --json   # machine-readable output
```

Output:

```
✅ deployed (2 files, 0.2 KiB)
   site:    https://drop-72b4900d-b71.chocolate-bassoon.workers.dev
   claim:   https://dash.cloudflare.com/claim-preview?claimToken=...
   expires: 2026-07-09T09:32:05.000Z (claim within 60 min to keep it)
```

Or install globally: `npm i -g cf-drop`.

## Programmatic API

```js
import { drop } from 'cf-drop';

const result = await drop('./dist', { onLog: console.error });
// { url, claimUrl, expiresAt, files, totalBytes }
```

## How it works

1. Solves a proof-of-work challenge (chained SHA-256) to get temporary deploy credentials — no login required
2. Uploads your files through the Workers static assets API (content-addressed, deduplicated)
3. Binds the assets to a temporary `drop-*` Worker and enables its `workers.dev` subdomain
4. Returns the live URL plus a claim link to keep the site permanently

## Use as a Claude Code skill

This repo ships an agent skill at [`skills/cf-drop/`](skills/cf-drop/SKILL.md). Install it with the [skills CLI](https://github.com/vercel-labs/skills) so your agent (Claude Code, Cursor, Codex, OpenCode, …) can deploy for you when you say things like "deploy this folder" or "share a quick preview":

```bash
npx skills add limboinf/cf-drop
```

Or install manually by copying:

```bash
# per-user (available in every project)
mkdir -p ~/.claude/skills && cp -r skills/cf-drop ~/.claude/skills/

# or per-project (committed with your repo)
mkdir -p .claude/skills && cp -r skills/cf-drop .claude/skills/
```

## Good to know

- **Deployments are public.** Anyone with the URL can see your files. Dotfiles and `node_modules` are skipped when uploading a folder.
- Static assets only (HTML/CSS/JS/images/fonts), 100MB total limit, `index.html` expected at the root.
- If a zip has a single top-level directory, it is stripped automatically so `index.html` lands at the site root.
- Unclaimed deployments expire after 60 minutes.
- Zero dependencies; requires Node.js ≥ 18.4.

---

## 中文

把文件夹或 zip 一键部署到 [Cloudflare Drop](https://www.cloudflare.com/drop/)：**免账号**、秒级上线、公网可访问，60 分钟内可认领到 Cloudflare 账号永久保留。

> 非官方工具，部署协议逆向自 Cloudflare Drop 官方 Web 端。使用即表示接受 [Cloudflare 服务条款](https://www.cloudflare.com/terms/)与[隐私政策](https://www.cloudflare.com/privacypolicy/)（与 Web 端弹窗要求接受的条款一致）。

### 使用

```bash
npx cf-drop ./dist          # 部署文件夹
npx cf-drop site.zip        # 部署 zip 包
npx cf-drop ./dist --json   # JSON 输出，方便脚本调用
```

也可以全局安装：`npm i -g cf-drop`。

### 编程调用

```js
import { drop } from 'cf-drop';

const result = await drop('./dist', { onLog: console.error });
// { url, claimUrl, expiresAt, files, totalBytes }
```

### 工作原理

1. 解一道工作量证明（链式 SHA-256）换取临时部署凭证，全程无需登录
2. 通过 Workers 静态资产 API 上传文件（内容寻址、自动去重）
3. 将资产绑定到临时 `drop-*` Worker 并开启 `workers.dev` 子域名
4. 返回站点 URL 和认领链接（认领后永久保留）

### 作为 Claude Code skill 使用

仓库自带 agent skill（[`skills/cf-drop/`](skills/cf-drop/SKILL.md)），用 [skills CLI](https://github.com/vercel-labs/skills) 一键安装（支持 Claude Code、Cursor、Codex、OpenCode 等），装上后说「把这个文件夹部署一下」「分享个临时预览」就能自动触发：

```bash
npx skills add limboinf/cf-drop
```

也可以手动拷贝安装：

```bash
# 用户级（所有项目可用）
mkdir -p ~/.claude/skills && cp -r skills/cf-drop ~/.claude/skills/

# 或项目级（随仓库提交）
mkdir -p .claude/skills && cp -r skills/cf-drop .claude/skills/
```

### 注意事项

- **部署是公开的**，拿到 URL 的任何人都能访问；上传文件夹时自动跳过隐藏文件和 `node_modules`
- 仅支持静态资源（HTML/CSS/JS/图片/字体），总大小 ≤ 100MB，根目录需要 `index.html`
- zip 包若只有一个顶层目录会自动剥掉，保证 `index.html` 落在站点根路径
- 未认领的部署 60 分钟后过期
- 零依赖，要求 Node.js ≥ 18.4

## License

MIT
