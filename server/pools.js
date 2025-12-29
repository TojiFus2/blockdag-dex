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
  let total0Raw = 0n;
  let total1Raw = 0n;
  let totalLpRaw = 0n;
  let depositCount = 0;
  let lastDepositMs = 0;

  for (const d of deposits) {
    if (!d || d.poolId !== poolId) continue;
    depositCount += 1;
    const a0 = BigInt(d.amount0Raw || d.bdagRaw || "0");
    const a1 = BigInt(d.amount1Raw || d.usdcRaw || "0");
    const lp = BigInt(d.lpRaw || "0");
    const kind = String(d.kind || "deposit");
    if (kind === "withdraw") {
      total0Raw -= a0;
      total1Raw -= a1;
      totalLpRaw -= lp;
    } else {
      total0Raw += a0;
      total1Raw += a1;
      totalLpRaw += lp;
    }
    const ts = Number(d.createdAtMs || 0);
    if (Number.isFinite(ts)) lastDepositMs = Math.max(lastDepositMs, ts);
  }

  if (total0Raw < 0n) total0Raw = 0n;
  if (total1Raw < 0n) total1Raw = 0n;
  if (totalLpRaw < 0n) totalLpRaw = 0n;

  return {
    depositCount,
    total0Raw: total0Raw.toString(),
    total1Raw: total1Raw.toString(),
    // backwards-compat keys (old UI expected these)
    totalBdagRaw: total0Raw.toString(),
    totalUsdcRaw: total1Raw.toString(),
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

function createPool({ owner, name, pair, baseSymbol, quoteSymbol, quoteAddress, token0Symbol, token1Symbol, token0Address, token1Address }) {
  if (!ethers.isAddress(owner || "")) throw new Error("Invalid owner address");

  const store = readStore();

  const id = makeId("pool");
  const ts = nowMs();

  const cleanPair = String(pair || "").trim().slice(0, 48);
  const cleanBase = String(baseSymbol || "").trim().slice(0, 16);
  const cleanQuote = String(quoteSymbol || "").trim().slice(0, 16);

  const cleanToken0Sym = String(token0Symbol || "").trim().slice(0, 24);
  const cleanToken1Sym = String(token1Symbol || "").trim().slice(0, 24);

  const cleanToken0Addr = String(token0Address || "").trim();
  const cleanToken1Addr = String(token1Address || "").trim();

  const finalToken0Address = cleanToken0Addr === "native" ? "native" : ethers.isAddress(cleanToken0Addr) ? cleanToken0Addr : "";
  const finalToken1Address = cleanToken1Addr === "native" ? "native" : ethers.isAddress(cleanToken1Addr) ? cleanToken1Addr : "";

  // legacy optional single-field quoteAddress still accepted (for older clients)
  const cleanQuoteAddr = String(quoteAddress || "").trim();
  const finalQuoteAddress = cleanQuoteAddr === "native" ? "native" : ethers.isAddress(cleanQuoteAddr) ? cleanQuoteAddr : "";

  const finalBase = cleanBase || (cleanToken0Sym || "TOKEN0");
  const finalQuote = cleanQuote || (cleanToken1Sym || "TOKEN1");
  const finalPair = cleanPair || (cleanToken0Sym && cleanToken1Sym ? `${cleanToken0Sym}/${cleanToken1Sym}` : `${finalBase}/${finalQuote}`);

  const pool = {
    id,
    chainId: CHAIN_ID,
    owner,
    name: String(name || "").trim().slice(0, 64) || "",
    pair: finalPair,
    baseSymbol: finalBase,
    quoteSymbol: finalQuote,
    quoteAddress: finalQuoteAddress,
    token0Symbol: cleanToken0Sym || finalBase,
    token1Symbol: cleanToken1Sym || finalQuote,
    token0Address: finalToken0Address,
    token1Address: finalToken1Address || finalQuoteAddress,
    createdAtMs: ts,
    createdAtIso: new Date(ts).toISOString(),
  };

  store.pools.push(pool);
  writeStore(store);

  return pool;
}

function addDeposit({ poolId, wallet, bdagRaw, usdcRaw, amount0Raw, amount1Raw, lpRaw, txHash }) {
  if (!poolId) throw new Error("Missing poolId");
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet address");

  const a0 = BigInt(amount0Raw || bdagRaw || "0");
  const a1 = BigInt(amount1Raw || usdcRaw || "0");
  const lp = BigInt(lpRaw || "0");
  if (a0 <= 0n) throw new Error("Invalid amount0");
  if (a1 <= 0n) throw new Error("Invalid amount1");
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
    amount0Raw: a0.toString(),
    amount1Raw: a1.toString(),
    // backwards-compat keys
    bdagRaw: a0.toString(),
    usdcRaw: a1.toString(),
    lpRaw: lp.toString(),
    txHash: txHash || "",
    createdAtMs: ts,
    createdAtIso: new Date(ts).toISOString(),
  };

  store.deposits.push(dep);
  writeStore(store);

  return dep;
}

function addWithdrawal({ poolId, wallet, bdagRaw, usdcRaw, amount0Raw, amount1Raw, lpRaw, txHash }) {
  if (!poolId) throw new Error("Missing poolId");
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet address");

  const a0 = BigInt(amount0Raw || bdagRaw || "0");
  const a1 = BigInt(amount1Raw || usdcRaw || "0");
  const lp = BigInt(lpRaw || "0");
  if (a0 < 0n) throw new Error("Invalid amount0");
  if (a1 < 0n) throw new Error("Invalid amount1");
  if (a0 === 0n && a1 === 0n) throw new Error("Invalid withdrawal amount");
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
    amount0Raw: a0.toString(),
    amount1Raw: a1.toString(),
    // backwards-compat keys
    bdagRaw: a0.toString(),
    usdcRaw: a1.toString(),
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
