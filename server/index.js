require("dotenv").config();

const http = require("http");
const { drip } = require("./faucet");

const PORT = Number(process.env.FAUCET_PORT || process.env.PORT || 8787);

// In produzione NON usare più "IS_DEV" per decidere se abilitare CORS.
// Il browser ti blocca la fetch se mancano gli header.
function getAllowedOrigin(req) {
  const origin = req.headers.origin;

  // Se non c'è Origin (es. curl/server-to-server), non serve CORS.
  if (!origin) return "";

  // Lista da env: "https://blockdag-dex.vercel.app,https://tuo-dominio.com"
  const raw = String(process.env.ALLOWED_ORIGINS || "").trim();
  if (!raw) {
    // fallback: se non configuri nulla, apri tutto (meno sicuro ma funziona)
    return "*";
  }

  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.includes(origin)) return origin;

  // non autorizzato
  return "";
}

function corsHeaders(req) {
  const allowOrigin = getAllowedOrigin(req);
  if (!allowOrigin) return {};

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    // Se un giorno usi cookie/creds, qui devi fare Allow-Credentials e NON puoi usare "*"
    // "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function sendJson(req, res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(req),
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

const server = http.createServer(async (req, res) => {
  try {
    // Preflight CORS
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders(req),
      });
      res.end();
      return;
    }

    // Health
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
});
