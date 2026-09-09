# PageChat – AI Webpage Chat & Site Summary

Chrome side-panel assistant: chat with the current page, summarize a whole site, extract company details, and translate.

**Store name:** PageChat – AI Webpage Summarizer  
**Version:** 1.4.0  
**Site:** https://pagechat-plugin-tvkj.vercel.app/  
**Privacy (Chrome Web Store):** https://pagechat-plugin-tvkj.vercel.app/privacy

Users do not add an API key. The model key lives on Vercel. The extension only talks to your proxy.

## Features

- Click the toolbar icon (or `Alt+Y`) to open a side-panel chat
- **Chat** by default: write, explain, code, and plan — the tab is not sent unless you check Include this page
- **Translate:** switch from the chip row, paste text, or right-click a selection
- **Company info:** name, address, phone, and email from footer, copyright, filings, and structured data
- **Summarize site:** read public pages on the current site and roll them into one brief
- Multiple chats, Markdown export, streaming replies

Chats stay in local `chrome.storage`. The model key is a Vercel environment variable, never shipped as a user-facing setting.

## Chrome Web Store

Publisher copy, permission justifications, Data safety answers, and screenshot sizes: [`store/CHROME_WEB_STORE.md`](store/CHROME_WEB_STORE.md).

Pack a zip (requires local `src/config.js`):

```powershell
.\scripts\pack-extension.ps1
```

Upload `store/dist/pagechat-1.4.0.zip`. The zip root must contain `manifest.json`.

## Deploy the proxy (you)

```bash
npx vercel
```

Vercel → Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `DEEPSEEK_API_KEY` | your model key |
| `APP_TOKEN` | a long random string (not the model key) |
| `DEEPSEEK_API_BASE` | optional, default `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | optional, default `deepseek-chat` |

Redeploy after saving env vars. Check https://pagechat-plugin-tvkj.vercel.app/health → `"ok": true` and `"deepseekConfigured": true`.

Copy `src/config.example.js` to `src/config.js` (gitignored):

```js
const HOSTED_API = {
  proxyUrl: "https://pagechat-plugin-tvkj.vercel.app/api/chat",
  appToken: "same value as APP_TOKEN on Vercel"
};
```

## Install (users)

Install from the Chrome Web Store (or load the packed zip you ship). Click the toolbar icon — no setup.

## Load unpacked (you)

1. Fill `src/config.js` with the Vercel `proxyUrl` and `appToken`
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → this folder
3. Reload after changing `src/config.js`

## Usage

- Default is **Chat**. **Translate** is a chip on the same row; it is not on until you click it
- Check **Include this page** so the model can read the current tab
- **Company info** prefers footer, copyright, and filing numbers
- **Summarize site** crawls about 10 public same-site pages (change the count in Settings)
- Select text, then right-click **Ask PageChat** or **Translate**
- Cannot read: Chrome Web Store, extension pages, some PDFs, `chrome://` URLs
- Content behind login, and pages the site does not link to, are not crawled

## Layout

```
manifest.json
website/               # Vercel static site (home, privacy, support)
api/chat.js            # Vercel streaming proxy (holds the model key)
src/background.js      # side panel, context menus, site crawl
src/config.js          # Vercel URL + APP_TOKEN (gitignored)
ui/sidepanel.html
store/CHROME_WEB_STORE.md
scripts/pack-extension.ps1
```

## Preview UI

Open `ui/sidepanel.html` without the extension for a local preview (fake replies, no model call).
