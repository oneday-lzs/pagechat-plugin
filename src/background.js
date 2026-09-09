importScripts("config.js");
importScripts("site.js");

const MENU = {
  ask: "pageyu-ask",
  translate: "pageyu-translate",
  summarize: "pageyu-summarize",
  site: "pageyu-site",
  company: "pageyu-company"
};

let crawlAbort = false;

async function enableSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("PageChat: could not set side panel behavior", error);
  }
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.ask,
      title: "Ask PageChat: “%s”",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU.translate,
      title: "Translate selection with PageChat",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU.summarize,
      title: "Summarize this page with PageChat",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: MENU.site,
      title: "Summarize this site with PageChat",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: MENU.company,
      title: "Extract company info with PageChat",
      contexts: ["page", "action"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  createMenus();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
});

enableSidePanel();

function emitProgress(payload) {
  chrome.runtime.sendMessage({ type: "PAGEYU_CRAWL_PROGRESS", ...payload }).catch(() => {});
}

async function extractPage(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractLivePage
    });
    return result || null;
  } catch {
    return null;
  }
}

async function fetchAndParse(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("html")) return null;
    const html = await response.text();
    return parseFetchedHtml(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function crawlSite(tabId, maxPages = 10) {
  crawlAbort = false;
  const seed = await extractPage(tabId);
  if (!seed) {
    throw new Error("Can't read this page (Chrome Web Store, extension pages, and PDFs are blocked)");
  }

  const origin = seed.origin || new URL(seed.url).origin;
  const limit = Math.min(20, Math.max(3, Number(maxPages) || 10));
  const seen = new Set([normalizeUrl(seed.url)]);
  const pages = [enrichPage(seed)];
  let queue = rankLinks(seed.links, origin, seed.url);

  emitProgress({
    done: 1,
    total: Math.min(limit, queue.length + 1),
    url: seed.url,
    title: seed.title
  });

  while (pages.length < limit && queue.length && !crawlAbort) {
    const batch = [];
    while (batch.length < 3 && queue.length && pages.length + batch.length < limit) {
      const next = queue.shift();
      const key = normalizeUrl(next);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      batch.push(next);
    }
    if (!batch.length) break;

    const results = await Promise.all(batch.map((url) => fetchAndParse(url)));
    for (const [index, page] of results.entries()) {
      if (crawlAbort) break;
      emitProgress({
        done: pages.length,
        total: limit,
        url: batch[index],
        title: page?.title || ""
      });
      if (!page || (page.text || "").length < 40) continue;
      pages.push(page);
      for (const extra of rankLinks(page.links, origin, seed.url)) {
        const key = normalizeUrl(extra);
        if (key && !seen.has(key)) queue.push(extra);
      }
    }
  }

  return {
    origin,
    hostname: seed.hostname,
    aborted: crawlAbort,
    pages
  };
}

async function openPanel(tab) {
  if (!tab) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id, windowId: tab.windowId });
  } catch {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.warn("PageChat: could not open the side panel", error);
    }
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const page = await extractPage(tab.id);
  const selection = (info.selectionText || page?.selection || "").trim();

  let pending;
  if (info.menuItemId === MENU.translate) {
    pending = {
      action: "send",
      includePage: false,
      text: `Translate the following into English. Keep the meaning, no extra commentary:\n\n${selection}`
    };
  } else if (info.menuItemId === MENU.summarize) {
    pending = {
      action: "send",
      includePage: true,
      text: "Summarize this page: 3–5 bullet points, then a short abstract under 80 words."
    };
  } else if (info.menuItemId === MENU.site) {
    pending = { action: "site-summary" };
  } else if (info.menuItemId === MENU.company) {
    pending = { action: "company" };
  } else {
    pending = {
      action: "draft",
      includePage: true,
      text: selection
    };
  }

  pending.page = page;
  pending.createdAt = Date.now();
  await chrome.storage.session.set({ pageyu_pending: pending });
  await openPanel(tab);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pagechat") return;
  let abort = null;
  port.onMessage.addListener((message) => {
    if (message?.type === "PAGEYU_CHAT_ABORT") {
      abort?.abort();
      return;
    }
    if (message?.type !== "PAGEYU_CHAT") return;
    abort = new AbortController();
    streamHostedChat(message.messages, message.temperature, abort.signal, port).catch((error) => {
      if (error.name === "AbortError") return;
      try {
        port.postMessage({ error: error.message || "Request failed" });
      } catch {
        // port closed
      }
    });
  });
  port.onDisconnect.addListener(() => abort?.abort());
});

function parseApiError(status, body) {
  try {
    const json = JSON.parse(body);
    return (typeof json.error === "string" ? json.error : json.error?.message) || json.message || body.slice(0, 240);
  } catch {
    return body.slice(0, 240) || `Request failed (${status})`;
  }
}

async function streamHostedChat(messages, temperature, signal, port) {
  const proxyUrl = String(HOSTED_API?.proxyUrl || "").trim();
  const appToken = String(HOSTED_API?.appToken || "").trim();
  if (!proxyUrl || !appToken) {
    throw new Error("PageChat is temporarily unavailable. Please try again later.");
  }

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appToken}`
    },
    body: JSON.stringify({
      temperature: Number(temperature) || 0.7,
      stream: true,
      messages
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(parseApiError(response.status, await response.text()));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content;
        if (token) port.postMessage({ delta: token });
      } catch {
        // ignore malformed sse chunks
      }
    }
  }
  port.postMessage({ done: true });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAGEYU_EXTRACT") {
    (async () => {
      const tab = message.tabId ? { id: message.tabId } : await activeTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No usable tab" });
        return;
      }
      const page = await extractPage(tab.id);
      if (!page) {
        sendResponse({ ok: false, error: "Can't read this page (Chrome Web Store, extension pages, and PDFs are blocked)" });
        return;
      }
      sendResponse({ ok: true, page });
    })();
    return true;
  }

  if (message?.type === "PAGEYU_CRAWL") {
    (async () => {
      try {
        const tab = await activeTab();
        if (!tab?.id) {
          sendResponse({ ok: false, error: "No usable tab" });
          return;
        }
        const dossier = await crawlSite(tab.id, message.maxPages);
        sendResponse({
          ok: true,
          dossier,
          context: formatDossier(dossier, message.maxChars)
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Site scan failed" });
      }
    })();
    return true;
  }

  if (message?.type === "PAGEYU_CRAWL_ABORT") {
    crawlAbort = true;
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "PAGEYU_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});
