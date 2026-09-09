# PageChat - AI Webpage Chat & Site Summary

Chrome side-panel assistant: chat with the current page, summarize a whole site, extract company details, and translate selections.

**Store name:** PageChat – AI Webpage Summarizer  
**Short name:** PageChat

Users do not add an API key. The model key lives on Vercel. The extension only talks to your proxy.

The public site (homepage, privacy, support) lives in `website/` and deploys on the same Vercel project as the chat API.

## Features

- Click the toolbar icon to open a side-panel chat
- **Company info:** pull name, address, phone, and email from footer, copyright, filings, and structured data
- **Summarize site:** read multiple public pages on the current site and roll them into one brief
- Optionally include the current tab’s body in context
- Right-click: ask about a selection, translate, summarize this page, summarize this site
- Multiple chats, Markdown export, streaming replies
- Shortcut `Alt+Y` to open the extension

Chats stay in local `chrome.storage`. The DeepSeek key is a Vercel environment variable, never shipped in the extension.

## Deploy the proxy (you)

From this folder:

```bash
npx vercel
```

In the Vercel project → Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `DEEPSEEK_API_KEY` | your DeepSeek key |
| `APP_TOKEN` | a long random string (not the DeepSeek key) |
| `DEEPSEEK_API_BASE` | optional, default `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | optional, default `deepseek-chat` |

Redeploy after saving env vars. Then open:

- `https://pagechat-plugin-tvkj.vercel.app/` — homepage
- `https://pagechat-plugin-tvkj.vercel.app/privacy` — privacy policy (use this URL in the Chrome Web Store)
- `https://pagechat-plugin-tvkj.vercel.app/support` — support
- `https://pagechat-plugin-tvkj.vercel.app/health` → `"ok": true` and `"deepseekConfigured": true`

Copy `src/config.example.js` to `src/config.js` and set:

```js
const HOSTED_API = {
  proxyUrl: "https://pagechat-plugin-tvkj.vercel.app/api/chat",
  appToken: "same value as APP_TOKEN on Vercel"
};
```

`src/config.js` is gitignored. Users never see it; they just install the packed extension.

## Install (users)

1. Install PageChat from the Chrome Web Store (or load the packed extension you ship)
2. Click the toolbar icon and start chatting — no setup

## Load unpacked (you)

1. Fill `src/config.js` with the Vercel `proxyUrl` and `appToken`
2. Open Chrome → `chrome://extensions` → Developer mode → Load unpacked → this folder
3. Reload the extension after changing `src/config.js`

## Usage

- Check **Include this page** so the model can read the current tab
- **Company info** prefers footer, copyright, and filing numbers
- **Summarize site** crawls about 10 public same-site pages (change the count in Settings)
- Select text on a page, then right-click **Ask PageChat** or **Translate**
- Pages that cannot be read: Chrome Web Store, extension pages, some PDFs / `chrome://` URLs
- Content behind login, and pages the site does not link to, are not crawled

## Layout

```
manifest.json
website/               # Vercel static site (home, privacy, support)
api/chat.js            # Vercel streaming proxy (holds the model key)
api/health.js
src/background.js      # side panel, context menus, site crawl, calls Vercel
src/config.js          # Vercel URL + APP_TOKEN (gitignored)
ui/sidepanel.html      # chat UI
ui/options.html        # temperature and crawl limits only
icons/
```

## Preview UI

You can open `ui/sidepanel.html` without loading the extension (preview mode fakes replies and does not call the model).
