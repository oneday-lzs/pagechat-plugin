# Chrome Web Store 上架资料（PageChat 1.4.0）

产品界面为英文。下面「可直接粘贴」的区块用英文填写开发者后台；操作说明用中文。

**上架后把商店链接填回**官网 `Get PageChat` 按钮和本文件顶部。

| 项 | 值 |
| --- | --- |
| 隐私政策 | https://pagechat-plugin-tvkj.vercel.app/privacy |
| 支持页 | https://pagechat-plugin-tvkj.vercel.app/support |
| 官网 | https://pagechat-plugin-tvkj.vercel.app/ |
| GitHub | https://github.com/oneday-lzs/pagechat-plugin |

---

## 1. 上架前检查

1. Vercel 已部署，打开 https://pagechat-plugin-tvkj.vercel.app/health 看到 `"ok": true` 且 `"deepseekConfigured": true`。
2. 本机 `src/config.js` 的 `proxyUrl`、`appToken` 与 Vercel 的 `APP_TOKEN` 一致（此文件不要提交 Git）。
3. `chrome://extensions` 加载本目录，测一遍：对话、Include this page、Summarize site、Company info、Translate、右键菜单、Alt+Y。
4. 在本目录运行 `.\scripts\pack-extension.ps1`，得到 `store/dist/pagechat-1.4.0.zip`。
5. 用该 zip 在 Chrome Web Store 开发者后台 **Upload new package**。

不要把 `website/`、`api/`、`.git`、`src/config.example.js` 打进扩展包。模型 Key 只在 Vercel。

---

## 2. 产品信息（可直接粘贴）

**Name**

```
PageChat – AI Webpage Summarizer
```

**Short description**（最多 132 字符）

```
Summarize any webpage or whole site, chat about the tab, extract company info, and translate. Ready to use — no API key.
```

**Category:** Productivity  
**Language:** English  
**Visibility:** Public  
**Price:** Free

**Homepage URL:** `https://pagechat-plugin-tvkj.vercel.app/`  
**Support URL:** `https://pagechat-plugin-tvkj.vercel.app/support`

**Detailed description**

```
PageChat is a Chrome side-panel assistant for the page you are already on. Install and start — you do not paste an API key.

Chat
Ask questions, draft text, explain ideas, or write code. The current tab is not sent unless you check Include this page.

Summarize this site
Reads public pages on the same site and rolls them into one brief: brand, offer, structure, contacts, and gaps.

Company info
Pulls legal name, address, phone, email, and filing numbers from the footer, copyright line, and structured data.

Translate
Switch to Translate in the side panel, paste text, or right-click a selection. Chinese defaults to English; other languages default to Simplified Chinese. You can name a target language.

What stays on your computer
Chats and settings are stored in Chrome on this device. You can export a thread as Markdown or clear all chats.

What is sent
Page text, a site extract, a selection, or a pasted image is sent only when you take that action. It goes to the PageChat proxy, then to the hosted model, to generate a reply.

Limits
Chrome Web Store pages, other extension pages, some PDFs, and chrome:// URLs cannot be read. Site summary follows public same-site links and does not crawl content behind login.

Shortcut: Alt+Y (Option+Y on some Mac layouts) opens PageChat.
```

---

## 3. 单一用途（Single purpose）

后台 **Privacy practices → Single purpose** 必填，且必须和权限匹配：

```
PageChat provides a Chrome side panel to chat with, summarize, and translate the webpage or website the user is viewing. It reads page text only when the user asks it to, and sends that text to a hosted model to generate a reply.
```

---

## 4. 权限说明（Justification）

CWS 会对每项权限提问。用英文回答：

**sidePanel**  
Opens the PageChat chat UI next to the current tab.

**storage**  
Saves chats, settings, and a pending right-click action on the user’s device.

**activeTab / tabs / scripting**  
Reads the current tab when the user checks Include this page, summarizes the site, extracts company info, or uses a context-menu action. The extension does not scrape tabs in the background.

**contextMenus**  
Adds Ask, Translate, Summarize page, Summarize site, and Company info to the right-click menu.

**Host permission (http://*/* and https://*/*)**  
The user may open PageChat on any website. Site summary and company info fetch public pages on the same hostname the user is viewing. Chat requests are posted to `https://pagechat-plugin-tvkj.vercel.app/api/chat`. Broad host access is required because the active site is not known in advance.

---

## 5. Data safety（数据声明）

按后台表单勾选（不要勾「不收集」——提示词会发到模型）：

| 问题 | 选择 |
| --- | --- |
| Does your extension collect or use user data? | Yes |
| Personally identifiable information | No（不要求账号、邮箱、姓名） |
| Health / financial / authentication | No |
| Personal communications | Yes — chat messages the user types |
| Location / web history / user activity | Web history / user activity：Yes — 当前页或站点正文，仅在用户主动操作时 |
| Sold to third parties | No |
| Used for ads or creditworthiness | No |
| Transferred to third parties | Yes — 托管模型服务商，仅用于生成回复 |
| Encryption in transit | Yes（HTTPS） |
| Users can request deletion | Yes — 侧边栏 Clear all；也可发邮件 |

说明文字：

```
PageChat stores chats locally in Chrome. Prompts and any page text the user chooses to include are sent over HTTPS to the PageChat proxy and then to the hosted model provider to generate a reply. We do not sell data or use it for advertising. Users can export or delete local chats in the side panel.
```

---

## 6. 截图（至少 1 张，建议 5 张）

要求：JPEG 或 PNG，**1280×800** 或 **640×400**。不要放商店审核后台的截图。

建议拍：

1. 对话模式空状态（Help me write / Explain / Write code / Make a plan / Translate）
2. 勾选 Include this page 后的问答
3. Summarize site 或 Company info 结果
4. Translate 模式（粘贴翻译）
5. 网页上右键菜单（Ask / Translate / Summarize）

小宣传图（可选）：440×280；大图 920×680；横幅 1400×560。没有也可先上架。

---

## 7. 审核常见驳回

- 隐私政策打不开或未写 host 权限、模型转发 → 已用上面的隐私页 URL。
- 声称「不收集数据」但实际把网页发给模型 → 用第 5 节的说法。
- 远程执行 JS → 扩展只 POST JSON 到自己的 API，不要 `eval` 远程脚本。
- 权限过宽 → 用第 4 节 host 说明。
- zip 里没有 `src/config.js` 或 Key 写进仓库 → 打包脚本会检查 config.js；Key 只放 Vercel。
