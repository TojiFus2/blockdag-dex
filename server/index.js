require("dotenv").config();

const http = require("http");
const { drip } = require("./faucet");

const PORT = Number(process.env.FAUCET_PORT || process.env.PORT || 8787);

// In produzione (Render) NODE_ENV è "production"
const IS_DEV = process.env.NODE_ENV !== "production";

// Allowlist CORS in prod: metti qui i domini Vercel
// es: "https://blockdag-dex.vercel.app,https://blockdag-ogtxhi3r5-tojifus2s-projects.vercel.app"
function getAllowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;

  if (IS_DEV) return "*";

  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return null;

  // match esatto
  if (allowed.includes(origin)) return origin;

  return null;
}

function sendJson(req, res, statusCode, obj) {
  const body = JSON.stringify(obj);

  const corsOrigin = resolveOrigin(req);
  const corsHeaders =
    corsOrigin
      ? {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        }
      : {};

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders,
  });
  res.end(body);
}

function sendNoContent(req, res) {
  const corsOrigin = resolveOrigin(req);
  const corsHeaders =
    corsOrigin
      ? {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        }
      : {};

  res.writeHead(204, { ...corsHeaders });
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Preflight CORS
    if (req.method === "OPTIONS") {
      sendNoContent(req, res);
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      sendJson(req, res, 200, { ok: true });
      return;
    }

    // Faucet
    if (req.method === "POST" && req.url === "/api/faucet/drip") {
      const body = await readJsonBody(req);
      const wallet = String(body?.wallet || "");
      const amount = body?.amount;

      const txHash = await drip({ wallet, amount });
      sendJson(req, res, 200, { ok: true, txHash });
      return;
    }

    sendJson(req, res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    sendJson(req, res, 400, { ok: false, error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`[faucet] listening on port ${PORT}`);
  if (!IS_DEV) {
    const allowed = getAllowedOrigins();
    console.log(`[faucet] production CORS allowlist: ${allowed.length ? allowed.join(", ") : "(none)"}`);
  }
});
