require("dotenv").config();

const http = require("http");
const { drip } = require("./faucet");

// ======================
// CONFIG
// ======================
const PORT = Number(process.env.FAUCET_PORT || process.env.PORT || 8787);

// Dominio consentito per CORS (metti quello di Vercel su Render)
// Esempio:
// CORS_ORIGIN=https://blockdag-dex.vercel.app
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";

// ======================
// UTILS
// ======================
function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),

    // ---- CORS (SEMPRE ATTIVO) ----
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(body);
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

// ======================
// SERVER
// ======================
const server = http.createServer(async (req, res) => {
  try {
    // ---- PREFLIGHT CORS ----
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // ---- HEALTHCHECK ----
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    // ---- FAUCET ----
    if (req.method === "POST" && req.url === "/api/faucet/drip") {
      const body = await readJsonBody(req);

      const wallet = String(body?.wallet || "");
      const amount = body?.amount;

      const txHash = await drip({ wallet, amount });

      sendJson(res, 200, {
        ok: true,
        txHash,
      });
      return;
    }

    // ---- NOT FOUND ----
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || String(e) });
  }
});

// ======================
// START
// ======================
server.listen(PORT, () => {
  console.log(`[faucet] listening on port ${PORT}`);
});
