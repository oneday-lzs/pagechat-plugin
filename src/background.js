importScripts("config.js");

const SKIP_RE =
  /\/(login|signin|signup|register|cart|checkout|logout|account|wp-admin|cdn-cgi)(\/|$)/i;
const SKIP_EXT_RE = /\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|mp3|css|js|woff2?|ico)(\?|$)/i;
const PRIORITY_RE =
  /about|product|pricing|contact|company|service|feature|solution|blog|doc|help|faq|news|team|career|download|price|legal|privacy|beian|官方|关于|产品|服务|方案|价格|联系|简介|介绍|新闻|帮助|文档|下载|备案|公司/i;

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tidyText(text) {
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach((key) => {
      url.searchParams.delete(key);
    });
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch {
    return "";
  }
}

function hostKey(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSameSite(target, origin) {
  const a = hostKey(target);
  const b = hostKey(origin);
  if (!a || !b || a !== b) return false;
  try {
    return new URL(target).protocol === new URL(origin).protocol;
  } catch {
    return false;
  }
}

function shouldSkip(url) {
  try {
    const parsed = new URL(url);
    if (SKIP_EXT_RE.test(parsed.pathname)) return true;
    if (SKIP_RE.test(parsed.pathname)) return true;
    if (parsed.search.length > 180) return true;
    return false;
  } catch {
    return true;
  }
}

function scoreUrl(url, seedUrl) {
  try {
    const parsed = new URL(url);
    const seed = new URL(seedUrl);
    let score = 0;
    if (parsed.pathname === "/" || parsed.pathname === "") score += 80;
    if (PRIORITY_RE.test(parsed.pathname + parsed.href)) score += 50;
    const depth = parsed.pathname.split("/").filter(Boolean).length;
    score += Math.max(0, 12 - depth * 3);
    if (parsed.hostname === seed.hostname) score += 8;
    if (parsed.search) score -= 6;
    return score;
  } catch {
    return 0;
  }
}

function collectHrefs(html, base) {
  const found = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const url = normalizeUrl(match[1], base);
    if (url) found.push(url);
  }
  return found;
}

function metaContent(html, ...names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
      "i"
    );
    const match = html.match(re);
    if (match) return decodeEntities(match[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:name|property)\\s*=\\s*["']${name}["']`,
      "i"
    );
    const match2 = html.match(re2);
    if (match2) return decodeEntities(match2[1]).trim();
  }
  return "";
}

function parseFetchedHtml(html, url) {
  const clipped = html.slice(0, 450000);
  const title = tidyText((clipped.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const description = metaContent(clipped, "description", "og:description");
  const siteName = metaContent(clipped, "og:site_name");
  const jsonLdParts = [];
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld;
  while ((ld = ldRe.exec(clipped)) && jsonLdParts.length < 4) {
    jsonLdParts.push(ld[1].trim());
  }
  const footerHtml = (clipped.match(/<footer[\s\S]*?<\/footer>/i) || [])[0] || "";
  const footer = tidyText(footerHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 1600);
  const headings = [];
  const headingRe = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  let heading;
  while ((heading = headingRe.exec(clipped)) && headings.length < 30) {
    const text = tidyText(heading[2].replace(/<[^>]+>/g, " "));
    if (text) headings.push(`${heading[1].toUpperCase()} ${text}`);
  }
  const stripped = clipped
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = tidyText(stripped).slice(0, 8000);
  const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])].slice(0, 8);
  const page = {
    title,
    url,
    origin: new URL(url).origin,
    hostname: new URL(url).hostname,
    description,
    siteName,
    headings,
    nav: [],
    emails,
    phones: [],
    links: collectHrefs(clipped, url),
    jsonLd: jsonLdParts.join("\n").slice(0, 2500),
    footer,
    selection: "",
    text
  };
  return enrichPage(page);
}

function extractLivePage() {
  const abs = (href) => {
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  };
  const textOf = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
  const meta = (selector) => document.querySelector(selector)?.getAttribute("content") || "";
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .map((node) => `${node.tagName} ${textOf(node)}`)
    .filter((line) => line.length > 3)
    .slice(0, 40);
  const nav = [...document.querySelectorAll("nav a, header a, [role='navigation'] a")]
    .map((node) => ({ text: textOf(node), href: abs(node.getAttribute("href") || "") }))
    .filter((item) => item.text && item.href)
    .slice(0, 50);
  const links = [...document.querySelectorAll("a[href]")]
    .map((node) => abs(node.getAttribute("href")))
    .filter(Boolean);
  const raw = document.body ? document.body.innerText : "";
  const text = raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []))].slice(0, 8);
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n")
    .slice(0, 2500);
  return {
    title: document.title || "",
    url: location.href,
    origin: location.origin,
    hostname: location.hostname,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    siteName: meta('meta[property="og:site_name"]'),
    headings,
    nav,
    emails,
    phones: [...new Set((text.match(/(?:\+?\d[\d\s\-()]{10,}\d)/g) || []))].slice(0, 6),
    links,
    jsonLd,
    footer: [...document.querySelectorAll("footer")].map(textOf).join("\n").slice(0, 1600),
    selection: (window.getSelection && window.getSelection().toString()) || "",
    text: text.slice(0, 14000)
  };
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const value = tidyText(String(item || ""));
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function walkJsonLd(node, bag) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonLd(item, bag));
    return;
  }
  if (typeof node !== "object") return;
  const type = String(node["@type"] || node.type || "");
  const isOrg = /Organization|LocalBusiness|Corporation|Brand|WebSite|EducationalOrganization|GovernmentOrganization/i.test(type);
  if (isOrg || node.legalName || node.brand) {
    if (node.name) bag.brands.push(node.name);
    if (node.legalName) bag.legalNames.push(node.legalName);
    if (node.alternateName) bag.brands.push(node.alternateName);
    if (typeof node.brand === "string") bag.brands.push(node.brand);
    if (node.brand?.name) bag.brands.push(node.brand.name);
    const address = node.address;
    if (typeof address === "string") bag.addresses.push(address);
    else if (address && typeof address === "object") {
      bag.addresses.push(
        [address.addressCountry, address.addressRegion, address.addressLocality, address.streetAddress, address.postalCode]
          .filter(Boolean)
          .join(" ")
      );
    }
    if (node.telephone) bag.phones.push(node.telephone);
    if (node.email) bag.emails.push(node.email);
  }
  if (node["@graph"]) walkJsonLd(node["@graph"], bag);
}

function parseJsonLdBag(raw) {
  const bag = { legalNames: [], brands: [], addresses: [], phones: [], emails: [] };
  if (!raw) return bag;
  const chunks = String(raw)
    .split(/\n\s*(?=\{|\[)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const tryParse = [raw, ...chunks];
  for (const chunk of tryParse) {
    try {
      walkJsonLd(JSON.parse(chunk), bag);
    } catch {
      // ignore malformed json-ld
    }
  }
  return bag;
}

function extractIcp(text) {
  return unique(
    String(text || "").match(
      /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼]ICP[备证]\d+号(?:-[A-Za-z0-9]+)?|[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼]公网安备\s*\d+号/g
    )
  );
}

function extractCompanyNames(text) {
  const source = String(text || "");
  const cn = source.match(
    /[\u4e00-\u9fa5A-Za-z0-9（）()]{2,40}(?:股份有限公司|有限责任公司|集团有限公司|科技有限公司|网络科技有限公司|有限公司|集团公司|集团)/g
  ) || [];
  const en =
    source.match(
      /\b[A-Z][A-Za-z0-9&.,'’\-\s]{1,50}(?:Incorporated|Corporation|Limited|Inc\.?|Ltd\.?|LLC|GmbH|Co\.,?\s*Ltd\.?|Corp\.?)\b/g
    ) || [];
  const copy =
    [...source.matchAll(/(?:©|版权所有|Copyright(?:\s*©)?)\s*(?:20\d{2}\s*[-–—]\s*)?(?:20\d{2}\s*)?([^\n|•·]{2,48})/gi)].map(
      (item) => item[1].replace(/版权所有|All Rights Reserved|\.?\s*$/gi, "").trim()
    );
  const junk = /^(有限公司|集团公司|集团|版权所有|保留所有权利|All Rights Reserved|Inc|Ltd)$/i;
  return unique([...cn, ...en, ...copy].filter((name) => name.length >= 3 && !junk.test(name)));
}

function extractAddresses(text) {
  return unique(
    String(text || "").match(
      /[\u4e00-\u9fa5]{2,}(?:省|自治区|特别行政区)?[\u4e00-\u9fa5]{1,8}(?:市|州|盟)[\u4e00-\u9fa5\d]{2,36}(?:号|座|栋|幢|楼|室|园)/g
    )
  ).slice(0, 6);
}

function extractIdentity(page) {
  const hay = [page.footer, page.text, page.title, page.description, page.siteName, page.jsonLd]
    .filter(Boolean)
    .join("\n");
  const ld = parseJsonLdBag(page.jsonLd);
  return {
    legalNames: unique([...ld.legalNames, ...extractCompanyNames(hay)]).slice(0, 8),
    brands: unique([page.siteName, ...ld.brands]).slice(0, 6),
    icp: extractIcp(hay).slice(0, 6),
    addresses: unique([...ld.addresses, ...extractAddresses(hay)]).slice(0, 6),
    emails: unique([...(page.emails || []), ...ld.emails]).slice(0, 8),
    phones: unique([...(page.phones || []), ...ld.phones]).slice(0, 8),
    copyrights: unique(
      String(hay).match(/(?:©|版权所有|Copyright)[^\n]{2,80}/gi)
    ).slice(0, 4)
  };
}

function enrichPage(page) {
  if (!page) return page;
  page.identity = extractIdentity(page);
  return page;
}

function mergeIdentity(pages) {
  const merged = { legalNames: [], brands: [], icp: [], addresses: [], emails: [], phones: [], copyrights: [] };
  for (const page of pages || []) {
    const id = page.identity || extractIdentity(page);
    for (const key of Object.keys(merged)) {
      merged[key] = unique([...merged[key], ...(id[key] || [])]);
    }
  }
  return merged;
}

function formatIdentity(identity) {
  const line = (label, values) =>
    `${label}: ${values && values.length ? values.join(" | ") : "Not found"}`;
  return `[Entity clues] (from footer, copyright, filings, and structured data)
${line("Company name candidates", identity.legalNames)}
${line("Brand / site name", identity.brands)}
${line("Filing numbers", identity.icp)}
${line("Address candidates", identity.addresses)}
${line("Email", identity.emails)}
${line("Phone", identity.phones)}
${line("Copyright", identity.copyrights)}`;
}

function rankLinks(links, origin, seedUrl) {
  const uniq = new Map();
  (links || []).forEach(function (item) {
    const href = normalizeUrl(item, seedUrl);
    if (!href || !isSameSite(href, origin) || shouldSkip(href)) return;
    if (normalizeUrl(seedUrl) === href) return;
    if (!uniq.has(href)) uniq.set(href, scoreUrl(href, seedUrl));
  });
  const ranked = Array.from(uniq.entries());
  ranked.sort(function (a, b) { return b[1] - a[1]; });
  const out = [];
  for (let i = 0; i < ranked.length; i += 1) out.push(ranked[i][0]);
  return out;
}

function formatPageBlock(page, index, textLimit) {
  const nav = (page.nav || [])
    .slice(0, 20)
    .map((item) => `${item.text} -> ${item.href}`)
    .join("；");
  const lines = [
    `## Page ${index + 1}`,
    `URL: ${page.url}`,
    `Title: ${page.title || "(none)"}`,
    page.siteName ? `Site name: ${page.siteName}` : "",
    page.description ? `Description: ${page.description}` : "",
    page.headings?.length ? `Headings:\n${page.headings.slice(0, 18).join("\n")}` : "",
    nav ? `Nav: ${nav}` : "",
    page.emails?.length ? `Email: ${page.emails.join(", ")}` : "",
    page.phones?.length ? `Phone: ${page.phones.join(", ")}` : "",
    page.footer ? `Footer: ${page.footer.slice(0, 400)}` : "",
    page.jsonLd ? `Structured data: ${page.jsonLd}` : "",
    `Body:\n${(page.text || "").slice(0, textLimit)}`
  ];
  return lines.filter(Boolean).join("\n");
}

function formatDossier(dossier, maxChars) {
  const pages = dossier.pages || [];
  const budget = Math.min(30000, Math.max(10000, Number(maxChars) * 2 || 20000));
  const perPage = Math.max(900, Math.floor(budget / Math.max(pages.length, 1)));
  const blocks = pages.map((page, index) =>
    formatPageBlock(page, index, index === 0 ? Math.min(8000, perPage + 2000) : perPage)
  );
  let body = blocks.join("\n\n");
  if (body.length > budget) body = body.slice(0, budget);
  const host = (dossier.hostname || "").replace(/^www\./, "");
  const identity = formatIdentity(mergeIdentity(pages));
  return `[Site dossier]
Site: ${host}
Source: public same-site pages, ${pages.length} read
Note: This is a sample of the site, not an exhaustive crawl. Write "Not found" for missing facts. Do not invent information.

${identity}

${body}`;
}


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
      agent: "translate",
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
