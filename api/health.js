const { sendJson, withCors, modelConfig } = require("./_lib");

module.exports = function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  const { apiKey } = modelConfig();
  return sendJson(res, 200, {
    ok: true,
    service: "pagechat",
    region: process.env.VERCEL_REGION || "unknown",
    deepseekConfigured: Boolean(apiKey),
    appTokenConfigured: Boolean(String(process.env.APP_TOKEN || "").trim())
  });
};
