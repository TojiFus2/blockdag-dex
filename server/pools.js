const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const POOLS_PATH = path.join(__dirname, "pools_1043.json");
const CHAIN_ID = 1043;

function nowMs() {
  return Date.now();
}

function makeId(prefix) {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${nowMs()}_${rnd}`;
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStore() {
  try {
    if (!fs.existsSync(POOLS_PATH)) {
      return { version: 1, chainId: CHAIN_ID, pools: [], deposits: [] };
    }
    const json = safeParseJson(fs.readFileSync(POOLS_PATH, "utf8"));
    if (!json || typeof json !== "object") return { version: 1, chainId: CHAIN_ID, pools: [], deposits: [] };
    return {
      version: 1,
      chainId: CHAIN_ID,
      pools: Array.isArray(json.pools) ? json.pools : [],
      deposits: Array.isArray(json.deposits) ? json.deposits : [],
    };
  } catch {
    return { version: 1, chainId: CHAIN_ID, pools: [], deposits: [] };
  }
}

function writeStore(store) {
  const tmp = `${POOLS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, POOLS_PATH);
}

function sumDepositsForPool(deposits, poolId) {
  let totalBdagRaw = 0n;
  let totalUsdcRaw = 0n;
  let totalLpRaw = 0n;
  let depositCount = 0;
  let lastDepositMs = 0;

  for (const d of deposits) {
    if (!d || d.poolId !== poolId) continue;
    depositCount += 1;
    const b = BigInt(d.bdagRaw || "0");
    const u = BigInt(d.usdcRaw || "0");
    const lp = BigInt(d.lpRaw || "0");
    const kind = String(d.kind || "deposit");
    if (kind === "withdraw") {
      totalBdagRaw -= b;
      totalUsdcRaw -= u;
      totalLpRaw -= lp;
    } else {
      totalBdagRaw += b;
      totalUsdcRaw += u;
      totalLpRaw += lp;
    }
    const ts = Number(d.createdAtMs || 0);
    if (Number.isFinite(ts)) lastDepositMs = Math.max(lastDepositMs, ts);
  }

  if (totalBdagRaw < 0n) totalBdagRaw = 0n;
  if (totalUsdcRaw < 0n) totalUsdcRaw = 0n;
  if (totalLpRaw < 0n) totalLpRaw = 0n;

  return {
    depositCount,
    totalBdagRaw: totalBdagRaw.toString(),
    totalUsdcRaw: totalUsdcRaw.toString(),
    totalLpRaw: totalLpRaw.toString(),
    lastDepositMs,
  };
}

function sumUserLpForPool(deposits, poolId, wallet) {
  let total = 0n;
  const key = String(wallet || "").toLowerCase();
  if (!key) return "0";

  for (const d of deposits) {
    if (!d || d.poolId !== poolId) continue;
    if (String(d.wallet || "").toLowerCase() !== key) continue;
    const lp = BigInt(d.lpRaw || "0");
    const kind = String(d.kind || "deposit");
    total += kind === "withdraw" ? -lp : lp;
  }

  if (total < 0n) total = 0n;
  return total.toString();
}

function listPools({ wallet } = {}) {
  const store = readStore();
  const pools = store.pools
    .map((p) => ({
      ...p,
      ...sumDepositsForPool(store.deposits, p.id),
      ...(wallet && ethers.isAddress(wallet) ? { userLpRaw: sumUserLpForPool(store.deposits, p.id, wallet) } : {}),
    }))
    .filter((p) => {
      const lp = BigInt(p.totalLpRaw || "0");
      if (lp > 0n) return true;
      const b = BigInt(p.totalBdagRaw || "0");
      const u = BigInt(p.totalUsdcRaw || "0");
      return b > 0n && u > 0n;
    });
  pools.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  return { chainId: CHAIN_ID, pools };
}

function getPool(poolId) {
  const store = readStore();
  const pool = store.pools.find((p) => p.id === poolId);
  if (!pool) return null;

  const deposits = store.deposits
    .filter((d) => d && d.poolId === poolId)
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

  return { chainId: CHAIN_ID, pool: { ...pool, ...sumDepositsForPool(store.deposits, poolId) }, deposits };
}

function createPool({ owner, name }) {
  if (!ethers.isAddress(owner || "")) throw new Error("Invalid owner address");

  const store = readStore();

  const id = makeId("pool");
  const ts = nowMs();
  const pool = {
    id,
    chainId: CHAIN_ID,
    owner,
    name: String(name || "").trim().slice(0, 64) || "",
    pair: "WBDAG/WUSDC",
    baseSymbol: "BDAG",
    quoteSymbol: "USDC",
    createdAtMs: ts,
    createdAtIso: new Date(ts).toISOString(),
  };

  store.pools.push(pool);
  writeStore(store);

  return pool;
}

function addDeposit({ poolId, wallet, bdagRaw, usdcRaw, lpRaw, txHash }) {
  if (!poolId) throw new Error("Missing poolId");
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet address");

  const b = BigInt(bdagRaw || "0");
  const u = BigInt(usdcRaw || "0");
  const lp = BigInt(lpRaw || "0");
  if (b <= 0n) throw new Error("Invalid BDAG amount");
  if (u <= 0n) throw new Error("Invalid USDC amount");
  if (lp <= 0n) throw new Error("Invalid LP amount");

  if (txHash) {
    const h = String(txHash);
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("Invalid txHash");
  }

  const store = readStore();
  const pool = store.pools.find((p) => p.id === poolId);
  if (!pool) throw new Error("Pool not found");

  const id = makeId("dep");
  const ts = nowMs();

  const dep = {
    id,
    poolId,
    wallet,
    kind: "deposit",
    bdagRaw: b.toString(),
    usdcRaw: u.toString(),
    lpRaw: lp.toString(),
    txHash: txHash || "",
    createdAtMs: ts,
    createdAtIso: new Date(ts).toISOString(),
  };

  store.deposits.push(dep);
  writeStore(store);

  return dep;
}

function addWithdrawal({ poolId, wallet, bdagRaw, usdcRaw, lpRaw, txHash }) {
  if (!poolId) throw new Error("Missing poolId");
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet address");

  const b = BigInt(bdagRaw || "0");
  const u = BigInt(usdcRaw || "0");
  const lp = BigInt(lpRaw || "0");
  if (b < 0n) throw new Error("Invalid BDAG amount");
  if (u < 0n) throw new Error("Invalid USDC amount");
  if (b === 0n && u === 0n) throw new Error("Invalid withdrawal amount");
  if (lp <= 0n) throw new Error("Invalid LP amount");

  if (txHash) {
    const h = String(txHash);
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("Invalid txHash");
  }

  const store = readStore();
  const pool = store.pools.find((p) => p.id === poolId);
  if (!pool) throw new Error("Pool not found");

  const id = makeId("wd");
  const ts = nowMs();

  const ev = {
    id,
    poolId,
    wallet,
    kind: "withdraw",
    bdagRaw: b.toString(),
    usdcRaw: u.toString(),
    lpRaw: lp.toString(),
    txHash: txHash || "",
    createdAtMs: ts,
    createdAtIso: new Date(ts).toISOString(),
  };

  store.deposits.push(ev);

  const totals = sumDepositsForPool(store.deposits, poolId);
  const tlp = BigInt(totals.totalLpRaw || "0");
  const tb = BigInt(totals.totalBdagRaw || "0");
  const tu = BigInt(totals.totalUsdcRaw || "0");
  if (tlp === 0n && tb === 0n && tu === 0n) {
    store.pools = store.pools.filter((p) => p && p.id !== poolId);
    store.deposits = store.deposits.filter((d) => d && d.poolId !== poolId);
  }

  writeStore(store);

  return ev;
}

module.exports = { listPools, getPool, createPool, addDeposit, addWithdrawal };
