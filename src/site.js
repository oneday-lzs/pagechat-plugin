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
  for (const item of links || []) {
    const url = normalizeUrl(item, seedUrl);
    if (!url || !isSameSite(url, origin) || shouldSkip(url)) continue;
    if (normalizeUrl(seedUrl) === url) continue;
    if (!uniq.has(url)) uniq.set(url, scoreUrl(url, seedUrl));
  }
  return [...uniq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);
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
