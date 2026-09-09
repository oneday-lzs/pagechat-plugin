const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function withCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, status, body) {
  withCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || "";
}

function assertAppToken(req) {
  const expected = String(process.env.APP_TOKEN || "").trim();
  if (!expected) return false;
  return getBearer(req) === expected;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function modelConfig() {
  return {
    apiKey: String(process.env.DEEPSEEK_API_KEY || "").trim(),
    baseUrl: String(process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: String(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim()
  };
}

module.exports = {
  assertAppToken,
  modelConfig,
  readJsonBody,
  sendJson,
  withCors
};
