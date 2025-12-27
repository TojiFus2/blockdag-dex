require("dotenv").config();

const http = require("http");
const { drip } = require("./faucet");
const { addDeposit, addWithdrawal, createPool, getPool, listPools } = require("./pools");

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
    const url = new URL(req.url || "/", "http://localhost");
    // Preflight CORS
    if (req.method === "OPTIONS") {
      sendNoContent(req, res);
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(req, res, 200, { ok: true });
      return;
    }

    // Faucet
    if (req.method === "POST" && url.pathname === "/api/faucet/drip") {
      const body = await readJsonBody(req);
      const wallet = String(body?.wallet || "");
      const amount = body?.amount;

      const txHash = await drip({ wallet, amount });
      sendJson(req, res, 200, { ok: true, txHash });
      return;
    }

    // Pools (persisted locally)
    if (req.method === "GET" && url.pathname === "/api/pools") {
      const wallet = String(url.searchParams.get("wallet") || "").trim();
      const out = listPools({ wallet });
      sendJson(req, res, 200, { ok: true, ...out });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pools") {
      const body = await readJsonBody(req);
      const owner = String(body?.owner || "");
      const name = String(body?.name || "");

      const pair = String(body?.pair || "");
      const baseSymbol = String(body?.baseSymbol || "");
      const quoteSymbol = String(body?.quoteSymbol || "");

      const pool = createPool({ owner, name, pair, baseSymbol, quoteSymbol });
      sendJson(req, res, 200, { ok: true, pool });
      return;
    }

    const poolMatch = url.pathname.match(/^\/api\/pools\/([^/]+)$/);
    if (req.method === "GET" && poolMatch) {
      const poolId = poolMatch[1];
      const out = getPool(poolId);
      if (!out) {
        sendJson(req, res, 404, { ok: false, error: "Pool not found" });
        return;
      }
      sendJson(req, res, 200, { ok: true, ...out });
      return;
    }

    const depMatch = url.pathname.match(/^\/api\/pools\/([^/]+)\/deposits$/);
    if (req.method === "POST" && depMatch) {
      const poolId = depMatch[1];
      const body = await readJsonBody(req);
      const wallet = String(body?.wallet || "");
      const bdagRaw = String(body?.bdagRaw || "");
      const usdcRaw = String(body?.usdcRaw || "");
      const lpRaw = String(body?.lpRaw || "");
      const txHash = String(body?.txHash || "");

      const dep = addDeposit({ poolId, wallet, bdagRaw, usdcRaw, lpRaw, txHash });
      sendJson(req, res, 200, { ok: true, deposit: dep });
      return;
    }

    const wdMatch = url.pathname.match(/^\/api\/pools\/([^/]+)\/withdrawals$/);
    if (req.method === "POST" && wdMatch) {
      const poolId = wdMatch[1];
      const body = await readJsonBody(req);
      const wallet = String(body?.wallet || "");
      const bdagRaw = String(body?.bdagRaw || "");
      const usdcRaw = String(body?.usdcRaw || "");
      const lpRaw = String(body?.lpRaw || "");
      const txHash = String(body?.txHash || "");

      const wd = addWithdrawal({ poolId, wallet, bdagRaw, usdcRaw, lpRaw, txHash });
      sendJson(req, res, 200, { ok: true, withdrawal: wd });
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
