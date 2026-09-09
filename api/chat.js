const { assertAppToken, modelConfig, readJsonBody, sendJson, withCors } = require("./_lib");

async function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!assertAppToken(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const { apiKey, baseUrl, model } = modelConfig();
  if (!apiKey || !baseUrl || !model) {
    return sendJson(res, 503, { error: "PageChat is temporarily unavailable. Please try again later." });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return sendJson(res, 400, { error: "messages required" });
  }

  const temperature = Math.min(1.5, Math.max(0, Number(body.temperature) || 0.7));
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: true,
        messages
      }),
      signal: abort.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      res.end();
      return;
    }
    return sendJson(res, 502, { error: "Could not reach the model" });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return sendJson(res, upstream.status, {
      error: text.slice(0, 240) || `Model error (${upstream.status})`
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const reader = upstream.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("PageChat stream error", error);
    }
  } finally {
    res.end();
  }
}

handler.config = { maxDuration: 60 };
module.exports = handler;
