require("dotenv").config();

const http = require("http");
const { drip } = require("./faucet");

const PORT = Number(process.env.FAUCET_PORT || process.env.PORT || 8787);
const IS_DEV = process.env.NODE_ENV !== "production";

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...(IS_DEV
      ? {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      : {}),
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
    if (IS_DEV) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...(IS_DEV
          ? {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            }
          : {}),
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/faucet/drip") {
      const body = await readJsonBody(req);
      const wallet = String(body?.wallet || "");
      const amount = body?.amount;

      const txHash = await drip({ wallet, amount });
      sendJson(res, 200, { ok: true, txHash });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[faucet] listening on http://localhost:${PORT}`);
});
