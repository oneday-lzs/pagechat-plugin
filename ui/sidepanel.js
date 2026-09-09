const IS_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  includePageByDefault: false,
  maxPageChars: 12000,
  maxSitePages: 10
};

const TRANSLATE_PROMPT = `You are PageChat Translate. Your job is to translate.
Detect the source language. If the user names a target language, use it. Otherwise: translate Chinese into English, and translate English or any other language into Simplified Chinese.
Keep meaning, tone, names, and formatting. Output the translation only — no preface, notes, or quotation marks unless the user asks for an explanation.
If page content is provided and the user did not paste other source text, translate that page or selection.`;

const CHAT_PROMPT = `You are PageChat, a general-purpose AI assistant. Answer directly. You can write code, translate, plan, and edit drafts.
You can see images the user attaches. Describe and answer from those images when they are present.
Match the user's language. Default to English if unclear.
If no page content is provided, do not mention, guess, or summarize the website the user might be browsing.
Be clear and natural. Use steps only when they help.`;

const PAGE_PROMPT = `You are PageChat, a Chrome side-panel assistant for the current webpage or website.
If page content or a "Site dossier" is provided, answer only from that material and any images the user attached. Say whether it came from this page, this site, or an attached image.
Match the user's language. Default to English if unclear.
Be accurate and concise. Use bullets when they help. If something is missing, write "Not found in the source" — do not invent facts.`;

const SITE_SUMMARY_PROMPT = `Using the site dossier, summarize everything known about this website. Do not rely on a single page.

Use this structure:
1. Company / brand: legal name and public brand (write Not found if missing)
2. One-line pitch: what this site does
3. Who it is for / what problem it solves
4. Core products, services, or content sections
5. Information architecture: what the main pages cover
6. Key facts: contact details, address, registration numbers, pricing (include if present, else Not found)
7. Gaps: information that is usually expected but was not captured this time

Rules: use the dossier only; do not invent facts; prefer names from the Entity clues section when they check out.`;

const COMPANY_PROMPT = `Extract only the company / operator behind this website. Do not write a long intro.

Start with the Entity clues at the top of the dossier, then check the footer, copyright, registration numbers, and About/Contact pages.
Output one line per field. If missing, write "Not found" and add a short source note in parentheses:

- Legal company name:
- Brand / public name:
- Registration / filing number:
- Address:
- Phone:
- Email:
- Website:
- Copyright year:

Do not treat nav labels, product names, or slogans as the company name. If there are several candidates, pick the most complete legal-looking name and list the rest under "Other candidates".`;

const memory = {
  local: {},
  session: {}
};

const storage = {
  async get(area, keys) {
    if (IS_EXTENSION) return chrome.storage[area].get(keys);
    const source = memory[area];
    const result = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const raw = localStorage.getItem(`pageyu:${area}:${key}`);
      result[key] = raw ? JSON.parse(raw) : source[key];
    }
    return result;
  },
  async set(area, values) {
    if (IS_EXTENSION) return chrome.storage[area].set(values);
    Object.assign(memory[area], values);
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(`pageyu:${area}:${key}`, JSON.stringify(value));
    }
  }
};

const els = {
  thread: document.getElementById("thread"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  includePage: document.getElementById("includePage"),
  historyBtn: document.getElementById("historyBtn"),
  newBtn: document.getElementById("newBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  drawer: document.getElementById("drawer"),
  convList: document.getElementById("convList"),
  closeDrawerBtn: document.getElementById("closeDrawerBtn"),
  exportBtn: document.getElementById("exportBtn"),
  clearBtn: document.getElementById("clearBtn"),
  pageChip: document.getElementById("pageChip"),
  pageChipText: document.getElementById("pageChipText"),
  refreshPageBtn: document.getElementById("refreshPageBtn"),
  subtitle: document.getElementById("subtitle"),
  toast: document.getElementById("toast"),
  pageQuick: document.getElementById("pageQuick"),
  chatQuick: document.getElementById("chatQuick"),
  siteBtn: document.getElementById("siteBtn"),
  attachBtn: document.getElementById("attachBtn"),
  fileInput: document.getElementById("fileInput"),
  attachList: document.getElementById("attachList")
};

let settings = { ...DEFAULT_SETTINGS };
let conversations = [];
let activeId = "";
let page = null;
let abort = null;
let sending = false;
let crawling = false;
let toastTimer = 0;
let pendingAttachments = [];
let activeAgent = "chat";

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 350000;
const MAX_REQUEST_IMAGE_CHARS = 2500000;
const TEXT_FILE_RE = /\.(txt|md|csv|json|xml|html|css|js|ts|py|log|svg)$/i;

function uid() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return Date.now();
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(text) {
  let s = escapeHtml(text || "");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[^\*])\*(?!\*)([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

function isFenceStart(line) {
  return /^```/.test(line);
}

function isTableSep(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const rows = [];
  let i = start + 2;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  const wide = header.length >= 4;
  const head = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");
  return {
    html: `<div class="md-table${wide ? " md-table-wide" : ""}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: i
  };
}

function lineIndent(line) {
  return (line.match(/^[ \t]*/) || [""])[0].replace(/\t/g, "  ").length;
}

function listMarker(line) {
  const ordered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ordered) {
    return { indent: ordered[1].replace(/\t/g, "  ").length, ordered: true, text: ordered[3] };
  }
  const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (bullet) {
    return { indent: bullet[1].replace(/\t/g, "  ").length, ordered: false, text: bullet[3] };
  }
  return null;
}

function parseList(lines, start) {
  const first = listMarker(lines[start]);
  if (!first) return { html: "", next: start };
  const baseIndent = first.indent;
  const ordered = first.ordered;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const mark = listMarker(lines[i]);
    if (!mark || mark.indent < baseIndent) break;
    if (mark.indent > baseIndent) break;
    if (mark.ordered !== ordered) {
      if (!ordered) break;
      const nested = parseList(lines, i);
      if (items.length) {
        items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested.html}</li>`);
        i = nested.next > i ? nested.next : i + 1;
        continue;
      }
      break;
    }

    i += 1;
    const chunks = [mark.text];
    const nestedHtml = [];

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j += 1;
        const peek = j < lines.length ? listMarker(lines[j]) : null;
        if (peek && peek.indent > baseIndent) {
          i = j;
          continue;
        }
        if (peek && peek.indent === baseIndent && peek.ordered === ordered) break;
        if (peek && peek.indent === baseIndent && ordered && !peek.ordered) {
          i = j;
          continue;
        }
        break;
      }
      if (/^(#{1,6})\s+/.test(line) || isFenceStart(line) || line.startsWith(">")) break;
      const nested = listMarker(line);
      if (nested) {
        if (nested.indent > baseIndent || (ordered && !nested.ordered && nested.indent >= baseIndent)) {
          const child = parseList(lines, i);
          nestedHtml.push(child.html);
          i = child.next > i ? child.next : i + 1;
          continue;
        }
        break;
      }
      if (lineIndent(line) > baseIndent || !listMarker(line)) {
        chunks.push(line.trim());
        i += 1;
        continue;
      }
      break;
    }

    const body = `<p class="ds-markdown-paragraph">${inlineMarkdown(chunks.join("\n")).replaceAll("\n", "<br>")}</p>`;
    items.push(`<li>${body}${nestedHtml.join("")}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}

function renderBlocks(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && (lines[i].startsWith(">") || (quote.length && lines[i].trim() === ""))) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(quote.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.+\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const table = parseTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const list = parseList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !isFenceStart(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^(\*\s*){3,}$|^(-\s*){3,}$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      `<p class="ds-markdown-paragraph">${inlineMarkdown(para.join("\n")).replaceAll("\n", "<br>")}</p>`
    );
  }
  return out.join("");
}

function renderCodeBlock(lang, code) {
  const label = escapeHtml((lang || "").trim());
  const body = escapeHtml(String(code || "").replace(/\n$/, ""));
  return `<div class="md-code-block"><div class="md-code-head"><span>${label}</span><button type="button" data-copy-code>Copy</button></div><pre><code>${body}</code></pre></div>`;
}

function renderMarkdown(raw) {
  const src = String(raw || "").replace(/\r\n/g, "\n");
  const segments = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = fence.exec(src))) {
    if (match.index > last) segments.push({ type: "md", text: src.slice(last, match.index) });
    segments.push({ type: "code", lang: match[1].trim(), code: match[2] });
    last = match.index + match[0].length;
  }
  const rest = src.slice(last);
  const openAt = rest.indexOf("```");
  if (openAt >= 0) {
    if (openAt > 0) segments.push({ type: "md", text: rest.slice(0, openAt) });
    const after = rest.slice(openAt + 3);
    const nl = after.indexOf("\n");
    const lang = (nl === -1 ? after : after.slice(0, nl)).trim();
    const code = nl === -1 ? "" : after.slice(nl + 1);
    segments.push({ type: "code", lang, code });
  } else if (rest) {
    segments.push({ type: "md", text: rest });
  }
  return segments
    .map((seg) => (seg.type === "code" ? renderCodeBlock(seg.lang, seg.code) : renderBlocks(seg.text)))
    .join("");
}

function activeConv() {
  return conversations.find((item) => item.id === activeId) || null;
}

function showToast(text) {
  els.toast.hidden = false;
  els.toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function currentAgent() {
  return activeAgent === "translate" ? "translate" : "chat";
}

function renderAgentBar() {
  const agent = currentAgent();
  document.querySelectorAll("[data-agent]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.agent === agent);
  });
}

async function selectAgent(agent) {
  if (agent !== "chat" && agent !== "translate") return;
  activeAgent = agent;
  let conv = activeConv();
  if (conv?.messages?.length && conv.agent !== agent) {
    conv = await createConversation(false);
  } else if (!conv) {
    conv = await createConversation(false);
  }
  conv.agent = agent;
  if (agent === "translate") {
    els.includePage.checked = false;
    if (conv.title === "New chat" || conv.title === "新对话") conv.title = "Translate";
  } else if (!conv.messages.length && conv.title === "Translate") {
    conv.title = "New chat";
  }
  await persistMode();
  await persist();
  applyMode();
  renderAll();
}

function pageModeOn() {
  return Boolean(els.includePage?.checked);
}

function applyMode() {
  const on = pageModeOn();
  const translate = currentAgent() === "translate";
  document.body.classList.toggle("translate-mode", translate);
  document.body.classList.toggle("page-mode", on && !translate);
  document.body.classList.toggle("chat-mode", !on && !translate);
  if (translate) {
    els.input.placeholder = "Paste text to translate";
    els.subtitle.textContent = "Translate";
    if (on) renderPageChip();
    else if (!crawling) {
      els.pageChip.hidden = true;
    }
  } else {
    els.input.placeholder = on ? "Ask about this page, translate, or just chat…" : "Message PageChat";
    if (!on && !crawling) {
      els.pageChip.hidden = true;
      els.subtitle.textContent = IS_EXTENSION ? "Chat" : "Browser preview";
    } else if (on) {
      renderPageChip();
    }
  }
  renderAgentBar();
}

async function persistMode() {
  settings.includePageByDefault = pageModeOn();
  await storage.set("local", { pageyu_settings: settings });
}

async function loadState() {
  const local = await storage.get("local", ["pageyu_settings", "pageyu_conversations", "pageyu_active_id"]);
  settings = { ...DEFAULT_SETTINGS, ...(local.pageyu_settings || {}) };
  conversations = local.pageyu_conversations || [];
  activeId = local.pageyu_active_id || conversations[0]?.id || "";
  activeAgent = "chat";
  els.includePage.checked = settings.includePageByDefault;
  if (!conversations.length) {
    await createConversation(false);
  } else {
    const conv = activeConv();
    if (conv?.agent === "translate" && !conv.messages.length) {
      conv.agent = "chat";
      if (conv.title === "Translate") conv.title = "New chat";
    } else if (conv?.agent === "translate") {
      const chatConv = conversations.find((item) => item.agent !== "translate");
      if (chatConv) activeId = chatConv.id;
      else await createConversation(false);
    }
  }
}

function serializeConversations(stripImages = false) {
  return conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map((msg) => ({
      ...msg,
      attachments: msg.attachments?.map((file) => {
        const slim = slimAttachment(file);
        if (stripImages) delete slim.dataUrl;
        return slim;
      })
    }))
  }));
}

async function persist() {
  try {
    await storage.set("local", {
      pageyu_conversations: serializeConversations(false),
      pageyu_active_id: activeId
    });
  } catch {
    try {
      await storage.set("local", {
        pageyu_conversations: serializeConversations(true),
        pageyu_active_id: activeId
      });
      showToast("Storage is full; image previews were not saved.");
    } catch {
      showToast("Could not save chats");
    }
  }
}

async function createConversation(render = true) {
  const agent = activeAgent === "translate" ? "translate" : "chat";
  const conv = {
    id: uid(),
    title: agent === "translate" ? "Translate" : "New chat",
    agent,
    messages: [],
    createdAt: now(),
    updatedAt: now()
  };
  conversations.unshift(conv);
  activeId = conv.id;
  await persist();
  if (render) {
    applyMode();
    renderAll();
  }
  return conv;
}

function renderAll() {
  renderThread();
  renderConversations();
}

function renderThread() {
  const conv = activeConv();
  els.thread.innerHTML = "";
  if (!conv || !conv.messages.length) {
    els.thread.innerHTML =
      currentAgent() === "translate"
        ? `
      <div class="empty">
        <h1>Translate</h1>
        <p>Paste text and send. Chinese goes to English, everything else to Simplified Chinese — or name a language.</p>
        <div class="suggestions">
          <button type="button" data-quick="tr-page-zh">Translate this page into Simplified Chinese</button>
          <button type="button" data-quick="tr-page-en">Translate this page into English</button>
          <button type="button" data-quick="tr-selection">Translate the selected text</button>
        </div>
      </div>`
        : pageModeOn()
          ? `
      <div class="empty">
        <h1>Start with this site</h1>
        <p>Summarize the site, extract company info, or ask about this page.</p>
        <div class="suggestions">
          <button type="button" data-quick="company">Extract company name, filings, and contacts</button>
          <button type="button" data-quick="site">Summarize everything known about this site</button>
          <button type="button" data-quick="summarize">Summarize the key points on this page</button>
        </div>
      </div>`
          : `
      <div class="empty">
        <h1>Hi, I'm PageChat</h1>
        <p>How can I help?</p>
        <div class="suggestions">
          <button type="button" data-quick="chat-write">Draft a concise weekly status update</button>
          <button type="button" data-quick="chat-explain">Explain large language models in plain English</button>
          <button type="button" data-quick="chat-code">Write a Python example that processes a CSV</button>
        </div>
      </div>`;
    return;
  }

  for (const [index, message] of conv.messages.entries()) {
    const article = document.createElement("article");
    article.className = `msg ${message.role}`;
    const streaming = message.streaming ? " cursor" : "";
    const body =
      message.role === "assistant"
        ? renderMarkdown(message.content)
        : escapeHtml(message.content).replaceAll("\n", "<br>");
    if (message.role === "user") {
      const files = message.attachments || [];
      const previews = files.length
        ? `<div class="attach-preview">${files
            .map((file) =>
              file.dataUrl?.startsWith("data:image/")
                ? `<img src="${file.dataUrl}" alt="${escapeHtml(file.name)}">`
                : `<span class="file-chip">${escapeHtml(file.name)}</span>`
            )
            .join("")}</div>`
        : "";
      article.innerHTML = `<div class="bubble">${previews}${body}</div>`;
    } else {
      article.innerHTML = `
        <div class="msg-head">
          <span class="msg-avatar" aria-hidden="true">P</span>
          <span class="msg-name">PageChat</span>
        </div>
        <div class="bubble markdown ds-markdown${streaming}${message.error ? " error-bubble" : ""}">${body || (message.streaming ? "" : "…")}</div>
        ${
          message.streaming
            ? ""
            : `<div class="msg-actions">
                <button type="button" data-copy="${index}" title="Copy" aria-label="Copy">
                  <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                ${
                  index === conv.messages.length - 1
                    ? `<button type="button" data-retry="${index}" title="Regenerate" aria-label="Regenerate">
                        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.3-6"/><path d="M21 3v6h-6"/></svg>
                      </button>`
                    : ""
                }
              </div>`
        }`;
    }
    els.thread.appendChild(article);
  }
  els.thread.scrollTop = els.thread.scrollHeight;
}

function renderConversations() {
  els.convList.innerHTML = conversations
    .map(
      (item) => `
      <div class="conv ${item.id === activeId ? "active" : ""}" data-id="${item.id}">
        <b>${escapeHtml(item.title)}</b>
        <button class="del" type="button" data-del="${item.id}" aria-label="Delete">Delete</button>
        <time>${formatTime(item.updatedAt)}</time>
      </div>`
    )
    .join("");
}

function renderPageChip() {
  els.pageChip.classList.remove("busy");
  if (!pageModeOn()) {
    els.pageChip.hidden = true;
    els.subtitle.textContent = IS_EXTENSION ? "Chat" : "Browser preview";
    return;
  }
  if (!page) {
    els.pageChip.hidden = !IS_EXTENSION;
    els.pageChipText.textContent = IS_EXTENSION ? "Couldn't read this page" : "Preview · sample page";
    els.subtitle.textContent = IS_EXTENSION ? "Page mode" : "Browser preview";
    return;
  }
  els.pageChip.hidden = false;
  els.pageChipText.textContent = page.title || page.url;
  els.subtitle.textContent = new URL(page.url, location.href).hostname.replace(/^www\./, "") || "This page";
}

function setCrawlProgress(text) {
  els.pageChip.hidden = false;
  els.pageChip.classList.add("busy");
  els.pageChipText.textContent = text;
}

async function fetchPage() {
  if (!IS_EXTENSION) {
    page = {
      title: "PageChat · preview",
      url: "https://example.com/preview",
      selection: "",
      text: "This is sample text in preview mode. After you load the Chrome extension, PageChat reads the real page you are viewing."
    };
    renderPageChip();
    return page;
  }
  const response = await chrome.runtime.sendMessage({ type: "PAGEYU_EXTRACT" });
  if (!response?.ok) {
    page = null;
    renderPageChip();
    if (response?.error) showToast(response.error);
    return null;
  }
  page = response.page;
  renderPageChip();
  return page;
}

function titleFrom(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 22) || "New chat";
}

function canSend() {
  return Boolean(els.input.value.trim() || pendingAttachments.length);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filesFromClipboard(event) {
  const dt = event.clipboardData;
  if (!dt) return [];
  const collected = [];
  const seen = new Set();
  const candidates = [];
  for (const item of dt.items || []) {
    if (item.kind === "file" || (item.type || "").startsWith("image/")) {
      candidates.push(item.getAsFile());
    }
  }
  for (const file of dt.files || []) candidates.push(file);
  for (const file of candidates) {
    if (!file) continue;
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push(file);
  }
  return collected;
}

function isImageFile(file) {
  const type = file.type || "";
  if (type === "image/svg+xml") return false;
  return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || "");
}

function dataUrlToFile(dataUrl, name) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  const type = match[1];
  const binary = atob(match[2].replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

function filesFromHtmlClipboard(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const files = [];
  let index = 0;
  for (const img of doc.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("data:image/")) continue;
    const file = dataUrlToFile(src, `pasted-image-${Date.now()}-${index}.png`);
    if (file) {
      files.push(file);
      index += 1;
    }
  }
  return files;
}

function collectPastedFiles(event) {
  const fromEvent = filesFromClipboard(event);
  if (fromEvent.length) return fromEvent;
  return filesFromHtmlClipboard(event.clipboardData?.getData("text/html") || "");
}

function isTextFile(file) {
  const type = file.type || "";
  return type.startsWith("text/") || type === "application/json" || TEXT_FILE_RE.test(file.name);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function attachmentContext(files, { mentionImages = false } = {}) {
  return (files || [])
    .map((file) => {
      if (file.text) {
        return `[Attached file: ${file.name}]\n${file.text}`;
      }
      if (file.kind === "image" && file.dataUrl && !mentionImages) return "";
      if (file.kind === "image") {
        return `[Attached image: ${file.name}]`;
      }
      return `[Attached file: ${file.name} (${file.type || "unknown"}, ${formatSize(file.size || 0)}). Binary content was not extracted.]`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function userContentForModel(item, includePixels = false) {
  const files = item.attachments || [];
  const images = includePixels ? files.filter((file) => file.kind === "image" && file.dataUrl?.startsWith("data:image/")) : [];
  const text = [item.content, attachmentContext(files, { mentionImages: !includePixels })].filter(Boolean).join("\n\n");
  if (!images.length) return text;
  const parts = [{ type: "text", text: text || "Please look at the attached image(s)." }];
  for (const image of images) {
    parts.push({
      type: "image_url",
      image_url: { url: image.dataUrl }
    });
  }
  return parts;
}

function compressImageDataUrl(dataUrl, maxEdge = 1280, quality = 0.82) {
  return new Promise((resolve) => {
    const finish = (out) => {
      resolve(out && out.startsWith("data:image/") && out.length <= MAX_DATA_URL_CHARS ? out : "");
    };
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let q = quality;
        let out = "";
        for (let i = 0; i < 8; i += 1) {
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          out = canvas.toDataURL("image/jpeg", q);
          if (out.length <= MAX_DATA_URL_CHARS) break;
          if (q > 0.4) q -= 0.1;
          else {
            width = Math.max(1, Math.round(width * 0.72));
            height = Math.max(1, Math.round(height * 0.72));
          }
        }
        finish(out);
      } catch {
        finish("");
      }
    };
    img.onerror = () => finish("");
    img.src = dataUrl;
  });
}

function slimAttachment(file) {
  const slim = {
    kind: file.kind,
    name: file.name,
    type: file.type,
    size: file.size
  };
  if (file.text) slim.text = file.text.slice(0, 24000);
  if (file.dataUrl && file.dataUrl.startsWith("data:image/") && file.dataUrl.length <= MAX_DATA_URL_CHARS) {
    slim.dataUrl = file.dataUrl;
  }
  return slim;
}

function renderAttachList() {
  if (!els.attachList) return;
  if (!pendingAttachments.length) {
    els.attachList.hidden = true;
    els.attachList.innerHTML = "";
    return;
  }
  els.attachList.hidden = false;
  els.attachList.innerHTML = pendingAttachments
    .map((file, index) => {
      const thumb = file.dataUrl?.startsWith("data:image/")
        ? `<img src="${file.dataUrl}" alt="">`
        : "";
      return `<div class="attach-chip">${thumb}<span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><button type="button" data-remove-attach="${index}" aria-label="Remove">×</button></div>`;
    })
    .join("");
}

async function addFiles(fileList) {
  const incoming = [...fileList];
  for (const file of incoming) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      showToast(`You can attach up to ${MAX_ATTACHMENTS} files`);
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(`${file.name} is larger than 8 MB`);
      continue;
    }
    try {
      if (isImageFile(file)) {
        const dataUrl = await compressImageDataUrl(await readFileAsDataUrl(file));
        if (!dataUrl) {
          showToast(`Could not attach ${file.name}`);
          continue;
        }
        pendingAttachments.push({
          kind: "image",
          name: file.name,
          type: "image/jpeg",
          size: file.size,
          dataUrl
        });
      } else if (isTextFile(file)) {
        pendingAttachments.push({
          kind: "file",
          name: file.name,
          type: file.type,
          size: file.size,
          text: (await readFileAsText(file)).slice(0, 24000)
        });
      } else {
        pendingAttachments.push({
          kind: "file",
          name: file.name,
          type: file.type,
          size: file.size
        });
      }
    } catch {
      showToast(`Could not read ${file.name}`);
    }
  }
  renderAttachList();
  if (!sending) els.sendBtn.disabled = !canSend();
}

function buildMessages(conv, includePage) {
  const translate = conv.agent === "translate";
  const pageAware = Boolean(conv.extraContext) || includePage;
  const messages = [
    {
      role: "system",
      content: translate ? TRANSLATE_PROMPT : pageAware ? PAGE_PROMPT : CHAT_PROMPT
    }
  ];
  if (conv.extraContext) {
    messages.push({ role: "system", content: conv.extraContext });
  } else if (includePage && page) {
    const limit = Number(settings.maxPageChars) || 12000;
    const meta = [
      page.description ? `Description: ${page.description}` : "",
      page.headings?.length ? `Headings: ${page.headings.slice(0, 12).join(" / ")}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    messages.push({
      role: "system",
      content: `[Current page]\nTitle: ${page.title}\nURL: ${page.url}\n${meta ? `${meta}\n` : ""}${page.selection ? `Selection: ${page.selection.slice(0, 2000)}\n` : ""}Body:\n${page.text.slice(0, limit)}`
    });
  }
  const pixelIndexes = new Set();
  let imageBudget = MAX_REQUEST_IMAGE_CHARS;
  for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
    const item = conv.messages[i];
    if (item.error || item.role !== "user") continue;
    const size = (item.attachments || [])
      .filter((file) => file.kind === "image" && file.dataUrl)
      .reduce((sum, file) => sum + file.dataUrl.length, 0);
    if (!size) continue;
    if (size > imageBudget) {
      if (pixelIndexes.size) break;
      continue;
    }
    pixelIndexes.add(i);
    imageBudget -= size;
  }
  for (const [index, item] of conv.messages.entries()) {
    if (item.error) continue;
    messages.push({
      role: item.role,
      content: item.role === "user" ? userContentForModel(item, pixelIndexes.has(index)) : item.content
    });
  }
  return messages;
}

async function streamChat({ messages, onDelta, signal }) {
  if (!IS_EXTENSION) {
    const isCompany = messages.some((item) => String(item.content || "").includes("Legal company name"));
    const isSite = messages.some((item) => String(item.content || "").includes("[Site dossier]"));
    const demo = isCompany
      ? "- Legal company name: Example Domain Inc (preview)\n- Brand / public name: Example\n- Registration / filing number: Not found\n- Address: Not found\n- Phone: Not found\n- Email: Not found\n- Website: https://example.com\n- Copyright year: Not found\n\nLoad the Chrome extension to extract this from a live site."
      : isSite
      ? "Preview sample. This demo site shows how PageChat rolls up multiple pages.\n\n1. Company / brand: Example (preview)\n2. One-line pitch: Introduces a product and contact details to visitors.\n3. Who it is for: People who need a quick picture of the site.\n4. Core content: Home, product, and contact pages.\n5. Information architecture: A small sample of public pages was read.\n6. Key facts: No real phone number or pricing in the source.\n7. Gaps: Load the extension in Chrome to read a live site."
      : "Browser preview. Load PageChat as a Chrome extension to chat with live pages.";
    for (const char of demo) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      onDelta(char);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return;
  }

  await new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "pagechat" });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      try {
        port.disconnect();
      } catch {
        // already closed
      }
      fn(value);
    };
    const onAbort = () => {
      try {
        port.postMessage({ type: "PAGEYU_CHAT_ABORT" });
      } catch {
        // port already closed
      }
      finish(reject, new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    port.onMessage.addListener((msg) => {
      if (msg.delta) onDelta(msg.delta);
      if (msg.error) finish(reject, new Error(msg.error));
      if (msg.done) finish(resolve);
    });
    port.onDisconnect.addListener(() => {
      if (!settled) finish(reject, new Error("Disconnected from PageChat"));
    });
    port.postMessage({
      type: "PAGEYU_CHAT",
      messages,
      temperature: Number(settings.temperature) || 0.7
    });
  });
}

async function sendText(text, { includePage = els.includePage.checked, extraContext = "", title = "", attachments } = {}) {
  const content = text.trim();
  const files = Array.isArray(attachments) ? attachments.slice() : pendingAttachments.slice();
  if ((!content && !files.length) || sending) return;
  if (!Array.isArray(attachments)) {
    pendingAttachments = [];
    renderAttachList();
  }
  sending = true;
  setBusy(true);

  try {
    if (includePage && !page && !extraContext) {
      await fetchPage();
    }

    let conv = activeConv();
    if (!conv) conv = await createConversation(false);
    if (title) conv.title = title;
    else if (conv.title === "New chat" || conv.title === "新对话") {
      conv.title = titleFrom(content || files[0]?.name || "Attachment");
    }
    if (extraContext) conv.extraContext = extraContext;
    if (!conv.agent) conv.agent = activeAgent;

    conv.messages.push({ role: "user", content, attachments: files, at: now() });
    const assistant = { role: "assistant", content: "", at: now(), streaming: true };
    conv.messages.push(assistant);
    conv.updatedAt = now();
    await persist();
    renderAll();

    abort = new AbortController();
    try {
      await streamChat({
        messages: buildMessages(conv, includePage),
        signal: abort.signal,
        onDelta: (token) => {
          assistant.content += token;
          renderThread();
        }
      });
      assistant.streaming = false;
    } catch (error) {
      assistant.streaming = false;
      if (error.name === "AbortError") {
        if (!assistant.content) assistant.content = "(stopped)";
      } else {
        assistant.error = true;
        assistant.content = assistant.content || `Error: ${error.message}`;
      }
    }
    conv.updatedAt = now();
    await persist();
    renderAll();
  } finally {
    abort = null;
    sending = false;
    setBusy(false);
  }
}

function setBusy(busy) {
  els.stopBtn.hidden = !busy;
  els.sendBtn.hidden = busy;
  els.input.disabled = busy;
  if (els.siteBtn) els.siteBtn.disabled = busy;
  document.querySelectorAll(".quick button").forEach((button) => {
    button.disabled = busy;
  });
  if (els.attachBtn) els.attachBtn.disabled = busy;
  if (els.fileInput) els.fileInput.disabled = busy;
  els.sendBtn.disabled = busy || !canSend();
}

function resizeInput() {
  const el = els.input;
  if (!el.value) {
    el.style.height = "40px";
    return;
  }
  el.style.height = "40px";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 120)}px`;
}

function openSettings() {
  if (IS_EXTENSION) {
    chrome.runtime.sendMessage({ type: "PAGEYU_OPEN_OPTIONS" });
    return;
  }
  location.href = "options.html";
}

function quickPrompt(kind) {
  const map = {
    summarize: "Summarize this page: 3–5 bullet points, then a short abstract under 80 words.",
    explain: "Explain this page in plain language for someone who has not read it.",
    outline: "Turn this page into a reading outline, grouped by section or topic.",
    translate: page?.selection
      ? `Translate the following into English. Keep the meaning, no extra commentary:\n\n${page.selection}`
      : "Translate the main content of this page into English.",
    "tr-page-zh": "Translate this page into Simplified Chinese. Keep meaning and tone. Output only the translation.",
    "tr-page-en": "Translate this page into English. Keep meaning and tone. Output only the translation.",
    "tr-selection": page?.selection
      ? `Translate the following. Detect the language and follow the Translate agent defaults. Output only the translation:\n\n${page.selection}`
      : "Translate the selected text on this page. If nothing is selected, translate the main content.",
    "tr-zh": "Translate into Simplified Chinese. Keep meaning and tone. Output only the translation.",
    "tr-en": "Translate into English. Keep meaning and tone. Output only the translation.",
    "chat-write": "Write a concise weekly status update I can send as-is: progress, blockers, and next week. Start with a structure, then sample sentences.",
    "chat-explain": "Explain how large language models work in plain English for a non-technical reader, under 400 words.",
    "chat-code": "Write a short Python example: read a CSV, print missing-value counts per column, with brief comments.",
    "chat-plan": "I want to improve English reading. Give me a two-week plan, no more than 30 minutes a day."
  };
  return map[kind] || kind;
}

function getPreviewDossier() {
  return `[Site dossier]
Site: example.com
Source: preview sample, 3 pages read

[Entity clues] (from footer, copyright, filings, and structured data)
Company name candidates: Example Domain Inc
Brand / site name: Example
Filing numbers: Not found
Address candidates: Not found
Email: Not found
Phone: Not found
Copyright: Copyright Example Domain

## Page 1
URL: https://example.com
Title: Example Domain
Description: Example domain used for documentation and demos.
Headings:
H1 Example Domain
Body:
This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.

## Page 2
URL: https://example.com/about
Title: About
Body: Sample about page. After you load the extension, PageChat crawls real About, product, and contact pages.

## Page 3
URL: https://example.com/contact
Title: Contact
Body: Sample contact page. No real phone or email in the source.`;
}

async function summarizeSite(mode = "site") {
  if (sending || crawling) return;

  const isCompany = mode === "company";
  let extraContext = getPreviewDossier();
  let host = "example.com";
  let pageCount = 3;

  if (IS_EXTENSION) {
    crawling = true;
    setBusy(true);
    setCrawlProgress(isCompany ? "Looking up company info…" : "Scanning this site…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "PAGEYU_CRAWL",
        maxPages: settings.maxSitePages || 10,
        maxChars: settings.maxPageChars
      });
      if (!response?.ok) {
        showToast(response?.error || "Site scan failed");
        return;
      }
      if (response.dossier?.aborted) {
        showToast("Scan stopped");
        return;
      }
      extraContext = response.context;
      host = (response.dossier?.hostname || "this site").replace(/^www\./, "");
      pageCount = response.dossier?.pages?.length || 0;
      if (!pageCount) {
        showToast("No pages found to summarize");
        return;
      }
    } finally {
      crawling = false;
      renderPageChip();
      if (!sending) setBusy(false);
    }
  }

  const prompt = isCompany ? COMPANY_PROMPT : SITE_SUMMARY_PROMPT;
  await createConversation(false);
  await sendText(`${prompt}\n\n(Read ${pageCount} pages on this site)`, {
    includePage: false,
    extraContext,
    title: `${isCompany ? "Company" : "Site summary"} · ${host}`
  });
}

async function consumePending() {
  const { pageyu_pending: pending } = await storage.get("session", ["pageyu_pending"]);
  if (!pending) return;
  await storage.set("session", { pageyu_pending: null });
  if (pending.page) {
    page = pending.page;
    renderPageChip();
  }
  if (pending.includePage) {
    els.includePage.checked = true;
    applyMode();
  }
  if (pending.agent === "translate") {
    activeAgent = "translate";
    const conv = activeConv();
    if (conv && !conv.messages.length) {
      conv.agent = "translate";
      if (conv.title === "New chat" || conv.title === "新对话") conv.title = "Translate";
    } else await createConversation(false);
    applyMode();
  }
  if (pending.action === "site-summary") {
    await summarizeSite("site");
    return;
  }
  if (pending.action === "company") {
    await summarizeSite("company");
    return;
  }
  if (pending.action === "send") {
    await sendText(pending.text, { includePage: Boolean(pending.includePage) });
  } else if (pending.text) {
    els.input.value = pending.text;
    els.input.focus();
  }
}

function download(name, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

els.attachBtn?.addEventListener("click", () => els.fileInput?.click());
els.fileInput?.addEventListener("change", async () => {
  if (els.fileInput.files?.length) await addFiles(els.fileInput.files);
  els.fileInput.value = "";
});
els.attachList?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-attach]");
  if (!btn) return;
  pendingAttachments.splice(Number(btn.dataset.removeAttach), 1);
  renderAttachList();
  if (!sending) els.sendBtn.disabled = !canSend();
});

window.addEventListener(
  "paste",
  (event) => {
    if (sending) return;
    const target = event.target;
    if (target && target !== els.input && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const files = collectPastedFiles(event);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files).then(() => {
      if (!sending) els.sendBtn.disabled = !canSend();
    });
  },
  true
);

els.sendBtn.addEventListener("click", () => {
  const text = els.input.value;
  els.input.value = "";
  els.sendBtn.disabled = true;
  resizeInput();
  sendText(text);
});

els.input.addEventListener("input", () => {
  if (!sending) els.sendBtn.disabled = !canSend();
  resizeInput();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!els.sendBtn.disabled) els.sendBtn.click();
  }
});

els.stopBtn.addEventListener("click", () => {
  abort?.abort();
  if (crawling && IS_EXTENSION) {
    chrome.runtime.sendMessage({ type: "PAGEYU_CRAWL_ABORT" }).catch(() => {});
  }
});
els.newBtn.addEventListener("click", () => createConversation(true));
els.settingsBtn.addEventListener("click", openSettings);
els.historyBtn.addEventListener("click", () => {
  els.drawer.hidden = false;
});
els.closeDrawerBtn.addEventListener("click", () => {
  els.drawer.hidden = true;
});
els.drawer.addEventListener("click", (event) => {
  if (event.target === els.drawer) els.drawer.hidden = true;
});
els.refreshPageBtn.addEventListener("click", fetchPage);
els.siteBtn?.addEventListener("click", () => summarizeSite("site"));
els.includePage.addEventListener("change", async () => {
  await persistMode();
  applyMode();
  renderThread();
  if (pageModeOn()) await fetchPage();
});

document.addEventListener("click", async (event) => {
  const agentBtn = event.target.closest("[data-agent]");
  if (agentBtn) {
    await selectAgent(agentBtn.dataset.agent);
    return;
  }
  const quick = event.target.closest("[data-quick]");
  if (quick) {
    const kind = quick.dataset.quick;
    if (kind.startsWith("tr-")) {
      if (currentAgent() !== "translate") await selectAgent("translate");
      const typed = els.input.value.trim();
      if ((kind === "tr-zh" || kind === "tr-en") && typed) {
        els.input.value = "";
        resizeInput();
        const target = kind === "tr-zh" ? "Simplified Chinese" : "English";
        await sendText(
          `Translate into ${target}. Keep meaning and tone. Output only the translation:\n\n${typed}`,
          { includePage: false }
        );
        return;
      }
      if (!pageModeOn()) {
        els.includePage.checked = true;
        await persistMode();
        applyMode();
        await fetchPage();
      }
      await sendText(quickPrompt(kind), { includePage: true });
      return;
    }
    if (kind === "site") {
      await summarizeSite("site");
      return;
    }
    if (kind === "company") {
      await summarizeSite("company");
      return;
    }
    const pageTask = !kind.startsWith("chat-");
    if (pageTask && !pageModeOn()) {
      els.includePage.checked = true;
      await persistMode();
      applyMode();
      await fetchPage();
    }
    await sendText(quickPrompt(quick.dataset.quick), { includePage: pageTask });
    return;
  }
  const copyCode = event.target.closest("[data-copy-code]");
  if (copyCode) {
    const pre = copyCode.closest(".md-code-block")?.querySelector("pre");
    if (pre) {
      await navigator.clipboard.writeText(pre.innerText);
      const prev = copyCode.textContent;
      copyCode.textContent = "Copied";
      setTimeout(() => {
        copyCode.textContent = prev;
      }, 1200);
    }
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const conv = activeConv();
    const item = conv?.messages[Number(copy.dataset.copy)];
    if (item) {
      await navigator.clipboard.writeText(item.content);
      showToast("Copied");
    }
    return;
  }
  const retry = event.target.closest("[data-retry]");
  if (retry) {
    const conv = activeConv();
    if (!conv) return;
    const assistantIndex = Number(retry.dataset.retry);
    conv.messages.splice(assistantIndex, 1);
    const lastUserIndex = conv.messages.findLastIndex((item) => item.role === "user");
    if (lastUserIndex < 0) return;
    const lastUser = conv.messages[lastUserIndex];
    const text = lastUser.content;
    const files = lastUser.attachments || [];
    conv.messages.splice(lastUserIndex, 1);
    await persist();
    await sendText(text, { attachments: files });
    return;
  }
  const convEl = event.target.closest(".conv");
  const del = event.target.closest("[data-del]");
  if (del) {
    event.stopPropagation();
    conversations = conversations.filter((item) => item.id !== del.dataset.del);
    if (!conversations.length) await createConversation(false);
    if (!conversations.some((item) => item.id === activeId)) {
      activeId = conversations[0].id;
      activeAgent = activeConv()?.agent === "translate" ? "translate" : "chat";
    }
    await persist();
    applyMode();
    renderAll();
    return;
  }
  if (convEl?.dataset.id) {
    activeId = convEl.dataset.id;
    activeAgent = activeConv()?.agent || "chat";
    await persist();
    els.drawer.hidden = true;
    applyMode();
    renderAll();
  }
});

els.exportBtn.addEventListener("click", () => {
  const conv = activeConv();
  if (!conv) return;
  const body = conv.messages
    .map((item) => {
      const files = (item.attachments || []).map((file) => file.name).join(", ");
      const extra = files ? `\n\nAttachments: ${files}` : "";
      return `## ${item.role === "user" ? "You" : "PageChat"}\n\n${item.content}${extra}`;
    })
    .join("\n\n");
  download(`${conv.title}.md`, `# ${conv.title}\n\n${body}\n`);
});

els.clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete all local chats?")) return;
  conversations = [];
  await createConversation(true);
  els.drawer.hidden = true;
});

if (IS_EXTENSION) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pageyu_settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.pageyu_settings.newValue };
    }
    if (area === "session" && changes.pageyu_pending?.newValue) {
      consumePending();
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PAGEYU_CRAWL_PROGRESS" && crawling) {
      let path = "";
      try {
        path = new URL(message.url).pathname;
      } catch {
        path = "";
      }
      setCrawlProgress(`Reading ${message.done}/${message.total}${path && path !== "/" ? ` · ${path}` : ""}`);
    }
  });
}

(async function init() {
  await loadState();
  applyMode();
  renderAll();
  if (pageModeOn()) await fetchPage();
  await consumePending();
  els.sendBtn.disabled = !canSend();
  resizeInput();
  els.input.focus();
})();
