import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import TokenSelectModal from "../components/TokenSelectModal";

import { loadDeployments } from "../lib/deployments";
import { getBrowserProvider, hasInjected, requestAccounts } from "../lib/eth";
import { TOKENS_1043 } from "../lib/tokens_1043";

const CHAIN_ID = 1043;
const MAIN_POOL_ID = "__main__";

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)",
];

const PAIR_ABI = [
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function transfer(address to, uint256 value) external returns (bool)",
  "function mint(address to) external returns (uint256 liquidity)",
  "function burn(address to) external returns (uint256 amount0, uint256 amount1)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function transfer(address to, uint256 value) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
];

const WETH_ABI = ["function withdraw(uint256) external"];

const ROUTER_ABI = [
  "function WETH() external view returns (address)",
  "function factory() external view returns (address)",
  "function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) external returns (uint256 amountA,uint256 amountB,uint256 liquidity)",
  "function addLiquidityETH((address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) p) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)",
];

// Testnet is flaky on estimateGas. Force high gas limits for demo.
const GAS = {
  APPROVE: 600_000n,
  TRANSFER: 600_000n,
  LIQ: 8_000_000n,
  REMOVE: 8_000_000n,
};

const DEADLINE_MINUTES = 20;

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

function sameAddr(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function shortAddr(a) {
  const s = String(a || "");
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function getImportedTokensKey(chainId) {
  const id = Number(chainId);
  return `dex.importedTokens.${Number.isFinite(id) ? id : "unknown"}`;
}

function safeParseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeImportedTokens(list) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    const addr = String(t?.address || "").trim();
    if (!addr) continue;
    if (!ethers.isAddress(addr)) continue;
    const lower = addr.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    out.push({
      symbol: String(t?.symbol || "").trim().slice(0, 16) || shortAddr(addr),
      name: String(t?.name || "").trim().slice(0, 64) || String(t?.symbol || "").trim().slice(0, 16) || shortAddr(addr),
      address: addr,
      decimals: Number.isFinite(Number(t?.decimals)) ? Number(t.decimals) : 18,
      isWrapped: false,
      isNative: false,
      imported: true,
    });
  }
  return out;
}

function normalizePairKey(pair) {
  const raw = String(pair || "").trim();
  if (!raw) return "";
  return raw.replace(/^WBDAG\//i, "BDAG/").toLowerCase();
}

function isZeroAddr(a) {
  return !a || String(a).toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

function sanitizeAmountInput(raw, maxDecimals) {
  const s = String(raw || "").replace(/[^\d.]/g, "");
  if (!s) return "";
  const parts = s.split(".");
  const intPart = parts[0] || "0";
  if (parts.length === 1) return intPart;
  const frac = (parts[1] || "").slice(0, Math.max(0, maxDecimals));
  return `${intPart}.${frac}`;
}

function trimDecimalsStr(str, maxDecimals) {
  const s = String(str || "");
  if (!s.includes(".")) return s;
  const [a, b = ""] = s.split(".");
  const trimmed = b.slice(0, Math.max(0, maxDecimals)).replace(/0+$/, "");
  return trimmed ? `${a}.${trimmed}` : a;
}

function parseUnitsSafe(s, decimals) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  try {
    return ethers.parseUnits(raw, decimals);
  } catch {
    return null;
  }
}

function formatUnitsTrim(raw, decimals, maxDecimals) {
  try {
    const s = ethers.formatUnits(raw ?? 0n, decimals);
    return trimDecimalsStr(s, maxDecimals);
  } catch {
    return "0";
  }
}

function safeBigInt(x, fallback = 0n) {
  try {
    return BigInt(x ?? 0);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryView(fn, retries = 4, delayMs = 350) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const v = await fn();
      if (typeof v === "string" && v === "0x") throw new Error("Empty 0x view result");
      return v;
    } catch (e) {
      last = e;
      if (i === retries - 1) throw last;
      await sleep(delayMs);
    }
  }
  throw last;
}

function calcRequiredUsdc(amountBdagRaw, reserveUsdcRaw, reserveWbdagRaw) {
  if (!amountBdagRaw || amountBdagRaw <= 0n) return 0n;
  if (!reserveUsdcRaw || reserveUsdcRaw <= 0n) return 0n;
  if (!reserveWbdagRaw || reserveWbdagRaw <= 0n) return 0n;
  return (amountBdagRaw * reserveUsdcRaw) / reserveWbdagRaw;
}

function calcRequiredBdag(amountUsdcRaw, reserveUsdcRaw, reserveWbdagRaw) {
  if (!amountUsdcRaw || amountUsdcRaw <= 0n) return 0n;
  if (!reserveUsdcRaw || reserveUsdcRaw <= 0n) return 0n;
  if (!reserveWbdagRaw || reserveWbdagRaw <= 0n) return 0n;
  return (amountUsdcRaw * reserveWbdagRaw) / reserveUsdcRaw;
}

function calcPriceUsdcPerBdagRaw(reserveUsdcRaw, reserveWbdagRaw) {
  if (!reserveUsdcRaw || !reserveWbdagRaw || reserveWbdagRaw <= 0n) return 0n;
  // USDC raw (6 decimals) per 1 BDAG
  return (reserveUsdcRaw * 10n ** 18n) / reserveWbdagRaw;
}

function getApiBase() {
  const envBase = import.meta.env.VITE_API_URL || import.meta.env.VITE_FAUCET_URL || "";
  if (envBase) return envBase;
  return import.meta.env.DEV ? "http://localhost:8787" : "";
}

function extractMintedLpFromReceipt({ receipt, pairAddress, to }) {
  try {
    if (!receipt || !pairAddress || !to) return 0n;
    const iface = new ethers.Interface(PAIR_ABI);
    const topic = iface.getEvent("Transfer").topicHash;
    const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
    let total = 0n;

    for (const l of logs) {
      if (!sameAddr(l?.address, pairAddress)) continue;
      if (!Array.isArray(l?.topics) || l.topics[0] !== topic) continue;
      const parsed = iface.parseLog(l);
      const from = String(parsed?.args?.from || parsed?.args?.[0] || "");
      const toAddr = String(parsed?.args?.to || parsed?.args?.[1] || "");
      const value = parsed?.args?.value ?? parsed?.args?.[2];
      if (!sameAddr(from, ethers.ZeroAddress)) continue;
      if (!sameAddr(toAddr, to)) continue;
      if (typeof value === "bigint") total += value;
    }

    return total;
  } catch {
    return 0n;
  }
}

export default function PoolPage() {
  const [pageStatus, setPageStatus] = useState("Idle");
  const [pageError, setPageError] = useState("");

  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [dep, setDep] = useState(null);

  const [routerFactoryAddr, setRouterFactoryAddr] = useState("");
  const [wrappedAddr, setWrappedAddr] = useState("");

  const [pairAddr, setPairAddr] = useState("");
  const [resToken1Raw, setResToken1Raw] = useState(0n);
  const [resToken2Raw, setResToken2Raw] = useState(0n);
  const [lpTotalSupplyRaw, setLpTotalSupplyRaw] = useState(0n);
  const [userLpRaw, setUserLpRaw] = useState(0n);

  const [refreshNonce, setRefreshNonce] = useState(0);

  const [addAmt1, setAddAmt1] = useState("0.1");
  const [addAmt2, setAddAmt2] = useState("");
  const [addStatus, setAddStatus] = useState("Idle");
  const [addTx, setAddTx] = useState("");
  const [addError, setAddError] = useState("");

  const [removeLp, setRemoveLp] = useState("");
  const [removeStatus, setRemoveStatus] = useState("Idle");
  const [removeTx, setRemoveTx] = useState("");
  const [removeError, setRemoveError] = useState("");

  const [pendingTx, setPendingTx] = useState("");

  const [poolsStatus, setPoolsStatus] = useState("Idle");
  const [poolsError, setPoolsError] = useState("");
  const [pools, setPools] = useState([]);
  const [expandedPoolId, setExpandedPoolId] = useState("");

  const [createAmt1, setCreateAmt1] = useState("0.1");
  const [createAmt2, setCreateAmt2] = useState("");
  const [createPoolStatus, setCreatePoolStatus] = useState("Idle");
  const [createPoolError, setCreatePoolError] = useState("");
  const [createPoolTx, setCreatePoolTx] = useState("");
  const [createPoolPairAddr, setCreatePoolPairAddr] = useState("");

  const [poolAddAmt1, setPoolAddAmt1] = useState("0.1");
  const [poolAddAmt2, setPoolAddAmt2] = useState("");
  const [poolDepositStatus, setPoolDepositStatus] = useState("Idle");
  const [poolDepositError, setPoolDepositError] = useState("");
  const [poolDepositTx, setPoolDepositTx] = useState("");

  const walletOk = hasInjected();

  const [importedTokens, setImportedTokens] = useState([]);

  useEffect(() => {
    const id = chainId || CHAIN_ID;
    try {
      const key = getImportedTokensKey(id);
      const raw = localStorage.getItem(key);
      setImportedTokens(normalizeImportedTokens(safeParseJson(raw || "[]", [])));
    } catch {
      setImportedTokens([]);
    }
  }, [chainId]);

  const defaultNativeAddr = useMemo(() => TOKENS_1043.find((t) => t?.isNative)?.address || "native", []);
  const defaultQuoteAddr = useMemo(() => {
    return (
      TOKENS_1043.find((t) => t?.symbol === "WUSDT")?.address ||
      TOKENS_1043.find((t) => t?.symbol === "WUSDC")?.address ||
      TOKENS_1043.find((t) => !t?.isWrapped && !t?.isNative)?.address ||
      ""
    );
  }, []);

  const [token1Addr, setToken1Addr] = useState(defaultNativeAddr);
  const [token2Addr, setToken2Addr] = useState(defaultQuoteAddr);

  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenModalTarget, setTokenModalTarget] = useState(null); // 't1'|'t2'|null
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");

  const selectableTokens = useMemo(() => {
    const merged = [...(TOKENS_1043 || []), ...(importedTokens || [])];
    const uniq = [];
    const seen = new Set();
    for (const t of merged) {
      if (!t) continue;
      if (t.isWrapped) continue; // pick BDAG instead
      const addr = String(t.address || "").trim();
      if (!addr) continue;
      const lower = addr.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      uniq.push(t);
    }
    return uniq;
  }, [importedTokens]);

  const tokenMetaByAddr = useMemo(() => {
    const map = new Map();
    for (const t of selectableTokens) map.set(String(t.address).toLowerCase(), t);
    return map;
  }, [selectableTokens]);

  function getTokenMeta(addr) {
    if (!addr) return null;
    const lower = String(addr).toLowerCase();
    const t = tokenMetaByAddr.get(lower);
    if (t) return t;
    return { symbol: shortAddr(addr), name: shortAddr(addr), address: addr, decimals: 18, isWrapped: false, isNative: false };
  }

  const token1Meta = useMemo(() => getTokenMeta(token1Addr), [token1Addr, tokenMetaByAddr]);
  const token2Meta = useMemo(() => getTokenMeta(token2Addr), [token2Addr, tokenMetaByAddr]);

  const token1IsNative = !!token1Meta?.isNative;
  const token2IsNative = !!token2Meta?.isNative;
  const sameTokenSelected = useMemo(() => {
    if (!token1Addr || !token2Addr) return false;
    return sameAddr(token1Addr, token2Addr);
  }, [token1Addr, token2Addr]);

  const bothNativeSelected = token1IsNative && token2IsNative;
  const hasNativeSelected = token1IsNative || token2IsNative;

  const selectedPairKey = useMemo(() => {
    const a = String(token1Meta?.symbol || "").trim();
    const b = String(token2Meta?.symbol || "").trim();
    if (!a || !b) return "";
    return `${a}/${b}`;
  }, [token1Meta, token2Meta]);

  const token1Decimals = useMemo(() => (token1IsNative ? 18 : Number(token1Meta?.decimals ?? 18)), [token1IsNative, token1Meta]);
  const token2Decimals = useMemo(() => (token2IsNative ? 18 : Number(token2Meta?.decimals ?? 18)), [token2IsNative, token2Meta]);

  const isSupportedChain = chainId === CHAIN_ID;

  function resolveOnchainAddr(addr, isNative) {
    if (!addr) return "";
    if (isNative) return wrappedAddr || "";
    return addr;
  }

  function closeTokenModal() {
    setIsTokenModalOpen(false);
    setTokenModalTarget(null);
    setTokenSearchQuery("");
  }

  function openTokenModal(target) {
    if (pendingTx) return;
    setTokenModalTarget(target);
    setTokenSearchQuery("");
    setIsTokenModalOpen(true);
  }

  function setTokenFromModal(t) {
    if (!t) return;
    if (pendingTx) return;
    const nextAddr = String(t.address || "");

    if (tokenModalTarget === "t1" && token2Addr && sameAddr(nextAddr, token2Addr)) {
      setPageError("Select two different tokens");
      closeTokenModal();
      return;
    }
    if (tokenModalTarget === "t2" && token1Addr && sameAddr(nextAddr, token1Addr)) {
      setPageError("Select two different tokens");
      closeTokenModal();
      return;
    }

    if (tokenModalTarget === "t1") setToken1Addr(nextAddr);
    if (tokenModalTarget === "t2") setToken2Addr(nextAddr);
    closeTokenModal();
  }

  async function importTokenByAddress(addr) {
    const a = String(addr || "").trim();
    if (!ethers.isAddress(a)) throw new Error("Invalid address");

    const existing = selectableTokens.find((t) => t?.address && sameAddr(t.address, a));
    if (existing) return existing;

    const provider = await getBrowserProvider();
    const c = new ethers.Contract(a, ERC20_ABI, provider);

    let symbol = "";
    let name = "";
    let decimals = 18;

    try {
      symbol = String(await c.symbol()).trim();
    } catch {}
    try {
      name = String(await c.name()).trim();
    } catch {}
    try {
      decimals = Number(await c.decimals());
    } catch {}

    const token = {
      symbol: symbol.slice(0, 16) || shortAddr(a),
      name: (name || symbol || shortAddr(a)).slice(0, 64),
      address: a,
      decimals: Number.isFinite(decimals) ? decimals : 18,
      isWrapped: false,
      isNative: false,
      imported: true,
    };

    const next = normalizeImportedTokens([...(importedTokens || []), token]);
    setImportedTokens(next);
    try {
      const id = chainId || CHAIN_ID;
      localStorage.setItem(getImportedTokensKey(id), JSON.stringify(next));
    } catch {}

    return token;
  }

  async function refreshBase() {
    if (!walletOk) {
      setPageError("No injected wallet found (MetaMask?)");
      setPageStatus("Ready");
      return;
    }

    setPageError("");
    setPageStatus("Loading...");

    try {
      const provider = await getBrowserProvider();
      const net = await provider.getNetwork();
      const cid = Number(net.chainId);
      setChainId(cid);

      const d = await loadDeployments(cid);
      setDep(d);

      const accounts = await provider.send("eth_accounts", []);
      setAccount(accounts?.[0] || "");

      setPageStatus("Ready");
    } catch (e) {
      setPageError(toErr(e));
      setPageStatus("Ready");
    }
  }

  useEffect(() => {
    refreshBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!walletOk) return;
    const handler = async () => {
      try {
        await refreshBase();
        setRefreshNonce((n) => n + 1);
      } catch {}
    };
    window.ethereum?.on?.("chainChanged", handler);
    window.ethereum?.on?.("accountsChanged", handler);
    return () => {
      window.ethereum?.removeListener?.("chainChanged", handler);
      window.ethereum?.removeListener?.("accountsChanged", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletOk]);

  // Load wrappedAddr + router.factory() from router
  useEffect(() => {
    if (!isSupportedChain) return;
    if (!dep?.router) return;

    let canceled = false;

    (async () => {
      try {
        const provider = await getBrowserProvider();
        const router = new ethers.Contract(dep.router, ROUTER_ABI, provider);
        const [w, f] = await Promise.allSettled([retryView(() => router.WETH()), retryView(() => router.factory())]);

        const wAddr = w.status === "fulfilled" ? w.value : "";
        const fAddr = f.status === "fulfilled" ? f.value : "";

        if (!canceled) {
          setWrappedAddr(wAddr || dep?.wrappedNative || dep?.wrapped || dep?.weth || "");
          setRouterFactoryAddr(fAddr || "");
        }
      } catch (e) {
        if (!canceled) setPageError(toErr(e));
      }
    })();

    return () => {
      canceled = true;
    };
  }, [dep?.router, dep?.wrappedNative, dep?.wrapped, dep?.weth, isSupportedChain]);

  const factoryAddr = routerFactoryAddr || dep?.factory || "";

  // Load pair + reserves + LP balances
  useEffect(() => {
    if (!isSupportedChain) return;
    if (!factoryAddr) return;
    if (!token1Addr || !token2Addr) return;
    if (sameTokenSelected) return;
    if (bothNativeSelected) return;
    if ((token1IsNative || token2IsNative) && !wrappedAddr) return;

    let canceled = false;

    (async () => {
      setPageError("");
      setPageStatus("Loading pool...");

      try {
        const provider = await getBrowserProvider();
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);

        const a = resolveOnchainAddr(token1Addr, token1IsNative);
        const b = resolveOnchainAddr(token2Addr, token2IsNative);
        if (!a || !b || sameAddr(a, b)) {
          if (!canceled) {
            setPairAddr("");
            setResToken1Raw(0n);
            setResToken2Raw(0n);
            setLpTotalSupplyRaw(0n);
            setUserLpRaw(0n);
            setPageStatus("Ready");
          }
          return;
        }

        const p = await retryView(() => factory.getPair(a, b));

        if (canceled) return;
        setPairAddr(p);

        if (isZeroAddr(p)) {
          setResToken1Raw(0n);
          setResToken2Raw(0n);
          setLpTotalSupplyRaw(0n);
          setUserLpRaw(0n);
          setPageStatus("Ready");
          return;
        }

        const pair = new ethers.Contract(p, PAIR_ABI, provider);
        const [t0, t1, rs, ts, ulp] = await Promise.all([
          retryView(() => pair.token0()),
          retryView(() => pair.token1()),
          retryView(() => pair.getReserves()),
          retryView(() => pair.totalSupply()),
          account ? retryView(() => pair.balanceOf(account)).catch(() => 0n) : Promise.resolve(0n),
        ]);

        const r0 = rs.reserve0 ?? rs[0] ?? 0n;
        const r1 = rs.reserve1 ?? rs[1] ?? 0n;

        let ra = 0n;
        let rb = 0n;
        if (sameAddr(t0, a) && sameAddr(t1, b)) {
          ra = r0;
          rb = r1;
        } else if (sameAddr(t1, a) && sameAddr(t0, b)) {
          ra = r1;
          rb = r0;
        }

        if (!canceled) {
          setResToken1Raw(ra);
          setResToken2Raw(rb);
          setLpTotalSupplyRaw(ts ?? 0n);
          setUserLpRaw(ulp ?? 0n);
          setPageStatus("Ready");
        }
      } catch (e) {
        if (!canceled) {
          setPageError(toErr(e));
          setPageStatus("Ready");
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    account,
    isSupportedChain,
    factoryAddr,
    token1Addr,
    token2Addr,
    token1IsNative,
    token2IsNative,
    wrappedAddr,
    sameTokenSelected,
    bothNativeSelected,
    refreshNonce,
    pendingTx,
  ]);

  const poolExists = !!pairAddr && !isZeroAddr(pairAddr);

  const addAmt1Raw = useMemo(() => parseUnitsSafe(addAmt1, token1Decimals) ?? 0n, [addAmt1, token1Decimals]);
  const addAmt2Raw = useMemo(() => parseUnitsSafe(addAmt2, token2Decimals) ?? 0n, [addAmt2, token2Decimals]);

  const createAmt1Raw = useMemo(() => parseUnitsSafe(createAmt1, token1Decimals) ?? 0n, [createAmt1, token1Decimals]);
  const createAmt2Raw = useMemo(() => parseUnitsSafe(createAmt2, token2Decimals) ?? 0n, [createAmt2, token2Decimals]);

  const poolAddAmt1Raw = useMemo(() => parseUnitsSafe(poolAddAmt1, token1Decimals) ?? 0n, [poolAddAmt1, token1Decimals]);
  const poolAddAmt2Raw = useMemo(() => parseUnitsSafe(poolAddAmt2, token2Decimals) ?? 0n, [poolAddAmt2, token2Decimals]);

  const price2Per1Text = useMemo(() => {
    if (resToken1Raw <= 0n || resToken2Raw <= 0n) return "\u2014";
    try {
      const pRaw = (resToken2Raw * 10n ** BigInt(token1Decimals)) / resToken1Raw;
      return formatUnitsTrim(pRaw, token2Decimals, 6);
    } catch {
      return "\u2014";
    }
  }, [resToken1Raw, resToken2Raw, token1Decimals, token2Decimals]);

  const lpTotalText = useMemo(() => formatUnitsTrim(lpTotalSupplyRaw, 18, 18), [lpTotalSupplyRaw]);
  const userLpText = useMemo(() => formatUnitsTrim(userLpRaw, 18, 18), [userLpRaw]);

  const isMainOpen = expandedPoolId === MAIN_POOL_ID;

  const addAmt1Display = addAmt1;
  const addAmt2Display = addAmt2;
  const createAmt1Display = createAmt1;
  const createAmt2Display = createAmt2;
  const poolAddAmt1Display = poolAddAmt1;
  const poolAddAmt2Display = poolAddAmt2;

  async function refreshPools() {
    const base = getApiBase();
    try {
      setPoolsError("");
      setPoolsStatus("Loading pools...");
      const qs = account && ethers.isAddress(account) ? `?wallet=${encodeURIComponent(account)}` : "";
      const res = await fetch(`${base}/api/pools${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPools(Array.isArray(json.pools) ? json.pools : []);
      setPoolsStatus("Idle");
    } catch (e) {
      setPoolsStatus("Idle");
      setPoolsError(toErr(e));
    }
  }

  async function connectWallet() {
    if (!walletOk) return;
    if (pendingTx) return;
    try {
      setPageError("");
      await requestAccounts();
      await refreshBase();
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      setPageError(toErr(e));
    }
  }

  useEffect(() => {
    refreshPools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!account) return;
    // on connect / change, refresh list so user sees newest pools
    refreshPools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    setPoolDepositError("");
    setPoolDepositTx("");
    setPoolDepositStatus("Idle");
    setRemoveError("");
    setRemoveTx("");
    setRemoveStatus("Idle");
    setRemoveLp("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedPoolId]);

  async function onCreatePoolWithDeposit() {
    if (pendingTx) return;
    if (!walletOk) return;
    if (!account) {
      setCreatePoolError("Connect wallet");
      return;
    }
    if (!token1Addr || !token2Addr) return setCreatePoolError("Select two tokens");
    if (sameTokenSelected) return setCreatePoolError("Select two different tokens");
    if (bothNativeSelected) return setCreatePoolError("Select at least one ERC20 token");
    if ((token1IsNative || token2IsNative) && !wrappedAddr) return setCreatePoolError("Wrapped token not loaded yet");

    setCreatePoolError("");
    setCreatePoolTx("");
    setCreatePoolPairAddr("");
    setCreatePoolStatus("Idle");

    const addRes = await runAddLiquidity({
      amount1Raw: createAmt1Raw,
      amount2Raw: createAmt2Raw,
      setStatus: setCreatePoolStatus,
      setError: setCreatePoolError,
      setTx: setCreatePoolTx,
      finalizeStatus: false,
    });

    const txHash = addRes?.txHash || "";
    const pairAfter = addRes?.pairAddr || "";
    const lpRaw = addRes?.lpMintedRaw ?? 0n;
    const usedAmt1Raw = addRes?.usedAmt1Raw ?? createAmt1Raw;
    const usedAmt2Raw = addRes?.usedAmt2Raw ?? createAmt2Raw;
    if (!txHash) return;
    if (pairAfter && !isZeroAddr(pairAfter)) setCreatePoolPairAddr(pairAfter);
    if (lpRaw <= 0n) {
      setCreatePoolStatus("Failed");
      setCreatePoolError("LP minted not detected");
      return;
    }

    const base = getApiBase();

    try {
      setCreatePoolStatus("Creating pool...");
      const res = await fetch(`${base}/api/pools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account,
          pair: selectedPairKey,
          baseSymbol: token1Meta?.symbol || "",
          quoteSymbol: token2Meta?.symbol || "",
          quoteAddress: token2Addr,
          token0Symbol: token1Meta?.symbol || "",
          token1Symbol: token2Meta?.symbol || "",
          token0Address: token1Addr,
          token1Address: token2Addr,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      const createdId = json?.pool?.id;
      if (!createdId) throw new Error("Pool id missing");

      setCreatePoolStatus("Recording liquidity...");
      const res2 = await fetch(`${base}/api/pools/${encodeURIComponent(createdId)}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: account,
          amount0Raw: usedAmt1Raw.toString(),
          amount1Raw: usedAmt2Raw.toString(),
          bdagRaw: usedAmt1Raw.toString(),
          usdcRaw: usedAmt2Raw.toString(),
          lpRaw: lpRaw.toString(),
          txHash,
        }),
      });
      const json2 = await res2.json().catch(() => ({}));
      if (!res2.ok || !json2?.ok) throw new Error(json2?.error || `HTTP ${res2.status}`);

      setCreatePoolStatus("Success");
      await refreshPools();
      setExpandedPoolId(createdId);
    } catch (e) {
      setCreatePoolStatus("Liquidity added (pool not recorded)");
      setCreatePoolError(toErr(e));
    }
  }

  async function runAddLiquidity({ amount1Raw, amount2Raw, setStatus, setError, setTx, finalizeStatus = true }) {
    if (pendingTx) return null;
    if (!walletOk) return null;
    if (!account) {
      setError("Connect wallet");
      return null;
    }
    if (!isSupportedChain) {
      setError(`Wrong network (chainId ${chainId ?? "?"})`);
      return null;
    }
    if (!dep?.router) {
      setError("Router not loaded");
      return null;
    }
    if (!factoryAddr) {
      setError("Factory not loaded");
      return null;
    }

    if (!token1Addr || !token2Addr) {
      setError("Select two tokens");
      return null;
    }
    if (sameTokenSelected) {
      setError("Select two different tokens");
      return null;
    }
    if (bothNativeSelected) {
      setError("Select at least one ERC20 token");
      return null;
    }

    const aAddr = String(token1Addr || "").trim();
    const bAddr = String(token2Addr || "").trim();
    if (!aAddr || !bAddr) {
      setError("Select two tokens");
      return null;
    }

    if (!token1IsNative && !ethers.isAddress(aAddr)) {
      setError("Token 1 address invalid");
      return null;
    }
    if (!token2IsNative && !ethers.isAddress(bAddr)) {
      setError("Token 2 address invalid");
      return null;
    }

    if ((token1IsNative || token2IsNative) && !wrappedAddr) {
      setError("Wrapped token not loaded");
      return null;
    }

    if (!amount1Raw || amount1Raw <= 0n) {
      setError(`Enter ${token1Meta?.symbol || "token 1"} amount`);
      return null;
    }
    if (!amount2Raw || amount2Raw <= 0n) {
      setError(`Enter ${token2Meta?.symbol || "token 2"} amount`);
      return null;
    }

    try {
      setStatus("Preparing tx...");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const router = new ethers.Contract(dep.router, ROUTER_ABI, signer);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * DEADLINE_MINUTES);

      const aOnchain = resolveOnchainAddr(aAddr, token1IsNative);
      const bOnchain = resolveOnchainAddr(bAddr, token2IsNative);
      if (!aOnchain || !bOnchain || sameAddr(aOnchain, bOnchain)) throw new Error("Invalid pair");

      let usedAmt1Raw = amount1Raw;
      let usedAmt2Raw = amount2Raw;

      let tx;

      if (token1IsNative || token2IsNative) {
        const nativeDesired = token1IsNative ? amount1Raw : amount2Raw;
        const tokenDesired = token1IsNative ? amount2Raw : amount1Raw;
        const tokenAddr = token1IsNative ? bAddr : aAddr;
        const tokenSym = token1IsNative ? token2Meta?.symbol : token1Meta?.symbol;

        const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

        setStatus("Checking allowance...");
        const allowance = await retryView(() => token.allowance(account, dep.router)).catch(() => 0n);
        if (allowance < tokenDesired) {
          setStatus(`Approving ${tokenSym || "token"}...`);
          const txA = await token.approve(dep.router, tokenDesired, { gasLimit: GAS.APPROVE });
          setPendingTx(txA.hash);
          setTx(txA.hash);
          setStatus(`Approve pending: ${txA.hash}`);
          await txA.wait();
          setPendingTx("");
        }

        try {
          const preview = await router.addLiquidityETH.staticCall(
            { token: tokenAddr, amountTokenDesired: tokenDesired, amountTokenMin: 0, amountETHMin: 0, to: account, deadline },
            { value: nativeDesired }
          );
          const usedToken = preview?.amountToken ?? preview?.[0] ?? tokenDesired;
          const usedEth = preview?.amountETH ?? preview?.[1] ?? nativeDesired;
          if (token1IsNative) {
            usedAmt1Raw = usedEth;
            usedAmt2Raw = usedToken;
          } else {
            usedAmt1Raw = usedToken;
            usedAmt2Raw = usedEth;
          }
        } catch {}

        setStatus("Adding liquidity...");
        tx = await router.addLiquidityETH(
          { token: tokenAddr, amountTokenDesired: tokenDesired, amountTokenMin: 0, amountETHMin: 0, to: account, deadline },
          { value: nativeDesired, gasLimit: GAS.LIQ }
        );
      } else {
        // Token/token: do it without router (works even if router lacks addLiquidity).
        // 1) Ensure pair exists.
        setStatus("Ensuring pair...");
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, signer);
        let p = await retryView(() => factory.getPair(aOnchain, bOnchain)).catch(() => ethers.ZeroAddress);
        if (isZeroAddr(p)) {
          setStatus("Creating pair...");
          const txP = await factory.createPair(aOnchain, bOnchain, { gasLimit: GAS.LIQ });
          setPendingTx(txP.hash);
          setTx(txP.hash);
          setStatus(`Pending: ${txP.hash}`);
          const rcP = await txP.wait();
          setPendingTx("");
          if (rcP?.status !== 1) throw new Error("createPair failed");
          p = await retryView(() => factory.getPair(aOnchain, bOnchain));
        }
        if (!p || isZeroAddr(p)) throw new Error("Pair not created");

        // 2) Compute optimal amounts (so we don't donate excess).
        let amountA = amount1Raw;
        let amountB = amount2Raw;

        try {
          const pairRO = new ethers.Contract(p, PAIR_ABI, provider);
          const [t0, t1, rs] = await Promise.all([retryView(() => pairRO.token0()), retryView(() => pairRO.token1()), retryView(() => pairRO.getReserves())]);
          const r0 = rs.reserve0 ?? rs[0] ?? 0n;
          const r1 = rs.reserve1 ?? rs[1] ?? 0n;

          let reserveA = 0n;
          let reserveB = 0n;
          if (sameAddr(t0, aOnchain) && sameAddr(t1, bOnchain)) {
            reserveA = r0;
            reserveB = r1;
          } else if (sameAddr(t1, aOnchain) && sameAddr(t0, bOnchain)) {
            reserveA = r1;
            reserveB = r0;
          }

          if (reserveA > 0n && reserveB > 0n) {
            const amountBOptimal = (amount1Raw * reserveB) / reserveA;
            if (amountBOptimal > 0n && amountBOptimal <= amount2Raw) {
              amountA = amount1Raw;
              amountB = amountBOptimal;
            } else {
              const amountAOptimal = (amount2Raw * reserveA) / reserveB;
              if (amountAOptimal > 0n) {
                amountA = amountAOptimal;
                amountB = amount2Raw;
              }
            }
          }
        } catch {}

        usedAmt1Raw = amountA;
        usedAmt2Raw = amountB;

        // 3) Transfer tokens to pair and mint.
        const tokenA = new ethers.Contract(aAddr, ERC20_ABI, signer);
        const tokenB = new ethers.Contract(bAddr, ERC20_ABI, signer);

        if (amountA <= 0n || amountB <= 0n) throw new Error("Amounts too small");

        setStatus("Checking balances...");
        const [balA, balB] = await Promise.all([
          retryView(() => tokenA.balanceOf(account)).catch(() => 0n),
          retryView(() => tokenB.balanceOf(account)).catch(() => 0n),
        ]);
        if (balA < amountA) throw new Error(`Insufficient ${token1Meta?.symbol || "token 1"} balance`);
        if (balB < amountB) throw new Error(`Insufficient ${token2Meta?.symbol || "token 2"} balance`);

        setStatus(`Sending ${token1Meta?.symbol || "token 1"}...`);
        const tx1 = await tokenA.transfer(p, amountA, { gasLimit: GAS.TRANSFER });
        setPendingTx(tx1.hash);
        setTx(tx1.hash);
        setStatus(`Pending: ${tx1.hash}`);
        const rc1 = await tx1.wait();
        setPendingTx("");
        if (rc1?.status !== 1) throw new Error("Token 1 transfer failed");

        setStatus(`Sending ${token2Meta?.symbol || "token 2"}...`);
        const tx2 = await tokenB.transfer(p, amountB, { gasLimit: GAS.TRANSFER });
        setPendingTx(tx2.hash);
        setTx(tx2.hash);
        setStatus(`Pending: ${tx2.hash}`);
        const rc2 = await tx2.wait();
        setPendingTx("");
        if (rc2?.status !== 1) throw new Error("Token 2 transfer failed");

        setStatus("Minting LP...");
        const pair = new ethers.Contract(p, PAIR_ABI, signer);
        tx = await pair.mint(account, { gasLimit: GAS.LIQ });
        setPendingTx(tx.hash);
        setTx(tx.hash);
        setStatus(`Pending: ${tx.hash}`);
        const rcM = await tx.wait();
        setPendingTx("");
        if (rcM?.status !== 1) throw new Error("Mint failed");

        const lpMintedRaw = extractMintedLpFromReceipt({ receipt: rcM, pairAddress: p, to: account });
        if (finalizeStatus) setStatus("Success");
        setRefreshNonce((n) => n + 1);
        return { txHash: tx.hash, receipt: rcM, pairAddr: p, lpMintedRaw, usedAmt1Raw, usedAmt2Raw };
      }

      setPendingTx(tx.hash);
      setTx(tx.hash);
      setStatus(`Pending: ${tx.hash}`);

      const rc = await tx.wait();
      setPendingTx("");
      if (rc?.status !== 1) throw new Error("Transaction failed");

      if (finalizeStatus) setStatus("Success");
      setRefreshNonce((n) => n + 1);

      let pairAfter = pairAddr;
      try {
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
        const p = await retryView(() => factory.getPair(aOnchain, bOnchain));
        if (p && !isZeroAddr(p)) pairAfter = p;
      } catch {}

      const lpMintedRaw = extractMintedLpFromReceipt({ receipt: rc, pairAddress: pairAfter, to: account });
      return { txHash: tx.hash, receipt: rc, pairAddr: pairAfter, lpMintedRaw, usedAmt1Raw, usedAmt2Raw };
    } catch (e) {
      setPendingTx("");
      setStatus("Failed");
      setError(toErr(e));
      setRefreshNonce((n) => n + 1);
      return null;
    }
  }

  async function onAddLiquidity() {
    setAddError("");
    setAddTx("");
    setAddStatus("Idle");
    await runAddLiquidity({
      amount1Raw: addAmt1Raw,
      amount2Raw: addAmt2Raw,
      setStatus: setAddStatus,
      setError: setAddError,
      setTx: setAddTx,
    });
  }

  async function onDepositToPool(pool) {
    if (pendingTx) return;
    if (!walletOk) return;
    if (!account) {
      setPoolDepositError("Connect wallet");
      return;
    }
    const poolId = String(pool?.id || "");
    const poolPair = String(pool?.pair || "");
    if (!poolId) {
      setPoolDepositError("Open a pool");
      return;
    }
    if (!token1Addr || !token2Addr) return setPoolDepositError("Select two tokens");
    if (sameTokenSelected) return setPoolDepositError("Select two different tokens");
    if (bothNativeSelected) return setPoolDepositError("Select at least one ERC20 token");
    if ((token1IsNative || token2IsNative) && !wrappedAddr) return setPoolDepositError("Wrapped token not loaded yet");

    // If the pool includes token addresses, match by addresses (order-insensitive).
    const poolToken0Address = String(pool?.token0Address || "").trim();
    const poolToken1Address = String(pool?.token1Address || "").trim();

    if (poolToken0Address && poolToken1Address) {
      const sa = resolveOnchainAddr(token1Addr, token1IsNative);
      const sb = resolveOnchainAddr(token2Addr, token2IsNative);
      const pa = resolveOnchainAddr(poolToken0Address, poolToken0Address === "native");
      const pb = resolveOnchainAddr(poolToken1Address, poolToken1Address === "native");

      const ok =
        !!sa &&
        !!sb &&
        !!pa &&
        !!pb &&
        ((sameAddr(sa, pa) && sameAddr(sb, pb)) || (sameAddr(sa, pb) && sameAddr(sb, pa)));

      if (!ok) {
        setPoolDepositError(`This pool is ${poolPair || "a different pair"}. Select the same pair before adding liquidity.`);
        return;
      }
    } else if (poolPair) {
      const sel = normalizePairKey(selectedPairKey);
      const poolK = normalizePairKey(poolPair);
      const selRev = sel.includes("/") ? sel.split("/").reverse().join("/") : sel;
      if (poolK !== sel && poolK !== selRev) {
        setPoolDepositError(`This pool is ${poolPair}. Select the same pair before adding liquidity.`);
        return;
      }
    }

    setPoolDepositError("");
    setPoolDepositTx("");
    setPoolDepositStatus("Idle");

    const base = getApiBase();

    const addRes = await runAddLiquidity({
      amount1Raw: poolAddAmt1Raw,
      amount2Raw: poolAddAmt2Raw,
      setStatus: setPoolDepositStatus,
      setError: setPoolDepositError,
      setTx: setPoolDepositTx,
      finalizeStatus: false,
    });

    const txHash = addRes?.txHash || "";
    const lpRaw = addRes?.lpMintedRaw ?? 0n;
    const usedAmt1Raw = addRes?.usedAmt1Raw ?? poolAddAmt1Raw;
    const usedAmt2Raw = addRes?.usedAmt2Raw ?? poolAddAmt2Raw;
    if (!txHash) return;
    if (lpRaw <= 0n) {
      setPoolDepositStatus("Failed");
      setPoolDepositError("LP minted not detected");
      return;
    }

    try {
      setPoolDepositStatus("Recording liquidity...");

      // Record in pool token order (pool.token0/token1), not UI-selected order.
      let recAmt0Raw = usedAmt1Raw;
      let recAmt1Raw = usedAmt2Raw;
      if (poolToken0Address && poolToken1Address) {
        const sa = resolveOnchainAddr(token1Addr, token1IsNative);
        const sb = resolveOnchainAddr(token2Addr, token2IsNative);
        const pa = resolveOnchainAddr(poolToken0Address, poolToken0Address === "native");
        const pb = resolveOnchainAddr(poolToken1Address, poolToken1Address === "native");
        if (sa && sb && pa && pb && sameAddr(sa, pb) && sameAddr(sb, pa)) {
          recAmt0Raw = usedAmt2Raw;
          recAmt1Raw = usedAmt1Raw;
        }
      }

      const res = await fetch(`${base}/api/pools/${encodeURIComponent(poolId)}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: account,
          amount0Raw: recAmt0Raw.toString(),
          amount1Raw: recAmt1Raw.toString(),
          bdagRaw: recAmt0Raw.toString(),
          usdcRaw: recAmt1Raw.toString(),
          lpRaw: lpRaw.toString(),
          txHash,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPoolDepositStatus("Success");
      await refreshPools();
    } catch (e) {
      setPoolDepositStatus("Liquidity added (not recorded)");
      setPoolDepositError(toErr(e));
    }
  }

  async function onRemoveLiquidity(recordPoolId = "") {
    if (pendingTx) return;
    if (!walletOk) return;
    if (!account) return setRemoveError("Connect wallet");
    if (!isSupportedChain) return setRemoveError(`Wrong network (chainId ${chainId ?? "?"})`);
    if (!pairAddr || isZeroAddr(pairAddr)) return setRemoveError("Pair not created yet");

    setRemoveError("");
    setRemoveTx("");
    setRemoveStatus("Idle");

    const lpRaw = parseUnitsSafe(removeLp, 18) ?? 0n;
    if (lpRaw <= 0n) return setRemoveError("Enter LP amount");
    let maxAllowed = userLpRaw;
    if (recordPoolId) {
      const rec = (pools || []).find((x) => x && x.id === recordPoolId);
      const recPair = String(rec?.pair || "");

      const recToken0Address = String(rec?.token0Address || "").trim();
      const recToken1Address = String(rec?.token1Address || "").trim();
      if (recToken0Address && recToken1Address) {
        const sa = resolveOnchainAddr(token1Addr, token1IsNative);
        const sb = resolveOnchainAddr(token2Addr, token2IsNative);
        const pa = resolveOnchainAddr(recToken0Address, recToken0Address === "native");
        const pb = resolveOnchainAddr(recToken1Address, recToken1Address === "native");

        const ok =
          !!sa &&
          !!sb &&
          !!pa &&
          !!pb &&
          ((sameAddr(sa, pa) && sameAddr(sb, pb)) || (sameAddr(sa, pb) && sameAddr(sb, pa)));

        if (!ok) return setRemoveError(`This pool is ${recPair || "a different pair"}. Select the same pair before removing liquidity.`);
      } else if (recPair) {
        const sel = normalizePairKey(selectedPairKey);
        const recK = normalizePairKey(recPair);
        const selRev = sel.includes("/") ? sel.split("/").reverse().join("/") : sel;
        if (recK !== sel && recK !== selRev) {
          return setRemoveError(`This pool is ${recPair}. Select the same pair before removing liquidity.`);
        }
      }

      const poolUserLpRaw = safeBigInt(rec?.userLpRaw);
      maxAllowed = poolUserLpRaw < userLpRaw ? poolUserLpRaw : userLpRaw;
      if (maxAllowed <= 0n) return setRemoveError("No LP in this pool");
      if (lpRaw > maxAllowed) return setRemoveError("LP amount exceeds your position in this pool");
    } else {
      if (lpRaw > userLpRaw) return setRemoveError("LP amount exceeds your balance");
    }

    try {
      setRemoveStatus("Preparing tx...");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, signer);

      setRemoveStatus("Sending LP to pair...");
      const tx1 = await pair.transfer(pairAddr, lpRaw, { gasLimit: GAS.REMOVE });
      setPendingTx(tx1.hash);
      setRemoveTx(tx1.hash);
      setRemoveStatus(`Pending: ${tx1.hash}`);
      const rc1 = await tx1.wait();
      setPendingTx("");
      if (rc1?.status !== 1) throw new Error("LP transfer failed");

      setRemoveStatus("Previewing burn...");
      const [t0, t1] = await Promise.all([retryView(() => pair.token0()), retryView(() => pair.token1())]);
      const preview = await pair.burn.staticCall(account).catch(() => null);
      const preview0 = preview?.amount0 ?? preview?.[0] ?? 0n;
      const preview1 = preview?.amount1 ?? preview?.[1] ?? 0n;

      setRemoveStatus("Burning LP...");
      const tx2 = await pair.burn(account, { gasLimit: GAS.REMOVE });
      setPendingTx(tx2.hash);
      setRemoveTx(tx2.hash);
      setRemoveStatus(`Pending: ${tx2.hash}`);
      const rc2 = await tx2.wait();
      setPendingTx("");
      if (rc2?.status !== 1) throw new Error("Burn failed");

      let amount0 = preview0;
      let amount1 = preview1;

      try {
        const iface = new ethers.Interface(PAIR_ABI);
        const burnTopic = iface.getEvent("Burn").topicHash;
        const logs = Array.isArray(rc2?.logs) ? rc2.logs : [];
        const burnLog = logs.find((l) => sameAddr(l?.address, pairAddr) && Array.isArray(l?.topics) && l.topics[0] === burnTopic);
        if (burnLog) {
          const parsed = iface.parseLog(burnLog);
          const a0 = parsed?.args?.amount0 ?? parsed?.args?.[1];
          const a1 = parsed?.args?.amount1 ?? parsed?.args?.[2];
          if (typeof a0 === "bigint") amount0 = a0;
          if (typeof a1 === "bigint") amount1 = a1;
        }
      } catch {}

      // Map burn outputs to the currently-selected token order (token1/token2)
      const a = resolveOnchainAddr(token1Addr, token1IsNative);
      const b = resolveOnchainAddr(token2Addr, token2IsNative);

      let out1 = 0n;
      let out2 = 0n;
      if (a && b) {
        if (sameAddr(t0, a) && sameAddr(t1, b)) {
          out1 = amount0;
          out2 = amount1;
        } else if (sameAddr(t1, a) && sameAddr(t0, b)) {
          out1 = amount1;
          out2 = amount0;
        }
      }

      // Convert wrapped native -> native (only if user selected a native token).
      if ((token1IsNative || token2IsNative) && wrappedAddr && !isZeroAddr(wrappedAddr)) {
        const wrappedOut = sameAddr(t0, wrappedAddr) ? amount0 : sameAddr(t1, wrappedAddr) ? amount1 : 0n;
        if (wrappedOut > 0n) {
          try {
            const weth = new ethers.Contract(wrappedAddr, WETH_ABI, signer);
            setRemoveStatus("Unwrapping native...");
            const txW = await weth.withdraw(wrappedOut, { gasLimit: GAS.REMOVE });
            setPendingTx(txW.hash);
            setRemoveTx(txW.hash);
            setRemoveStatus(`Pending: ${txW.hash}`);
            const rcW = await txW.wait();
            setPendingTx("");
            if (rcW?.status !== 1) throw new Error("Unwrap failed");
          } catch (e) {
            setPendingTx("");
            setRemoveError(`Unwrap failed (you received wrapped): ${toErr(e)}`);
          }
        }
      }

      if (recordPoolId && (out1 > 0n || out2 > 0n)) {
        try {
          // Record in pool token order, not UI-selected order.
          let recOut0 = out1;
          let recOut1 = out2;

          const rec = (pools || []).find((x) => x && x.id === recordPoolId);
          const recToken0Address = String(rec?.token0Address || "").trim();
          const recToken1Address = String(rec?.token1Address || "").trim();
          if (recToken0Address && recToken1Address) {
            const pa = resolveOnchainAddr(recToken0Address, recToken0Address === "native");
            const pb = resolveOnchainAddr(recToken1Address, recToken1Address === "native");
            if (pa && pb) {
              if (sameAddr(t0, pa) && sameAddr(t1, pb)) {
                recOut0 = amount0;
                recOut1 = amount1;
              } else if (sameAddr(t1, pa) && sameAddr(t0, pb)) {
                recOut0 = amount1;
                recOut1 = amount0;
              }
            }
          }

          setRemoveStatus("Recording withdrawal...");
          const base = getApiBase();
          await fetch(`${base}/api/pools/${encodeURIComponent(recordPoolId)}/withdrawals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wallet: account,
              amount0Raw: recOut0.toString(),
              amount1Raw: recOut1.toString(),
              bdagRaw: recOut0.toString(),
              usdcRaw: recOut1.toString(),
              lpRaw: lpRaw.toString(),
              txHash: tx2.hash,
            }),
          });
          await refreshPools();
        } catch {}
      }

      setRemoveStatus("Success");
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      setPendingTx("");
      setRemoveStatus("Failed");
      setRemoveError(toErr(e));
      setRefreshNonce((n) => n + 1);
    }
  }

  return (
    <div className="container">
      <div className="swapShell">
        {!walletOk && (
          <div className="card swapCard">
            <div className="cardHeader swapHeader">
              <div>
                <div className="title">Pool</div>
                <div className="sub">Wallet not detected</div>
              </div>
            </div>
            <div className="swapStatus bad">No injected wallet found (MetaMask?).</div>
          </div>
        )}

        {walletOk && !account && (
          <div className="card swapCard">
            <div className="cardHeader swapHeader">
              <div>
                <div className="title">Pool</div>
                <div className="sub">Connect wallet</div>
              </div>
            </div>
            <button type="button" className="btn swapCta" disabled={!!pendingTx} onClick={connectWallet}>
              Connect wallet
            </button>
            {!!pageError && <div className="swapStatus bad">{pageError}</div>}
          </div>
        )}

        {walletOk && !!account && (
          <>
            <div className="card swapCard">
              <div className="cardHeader swapHeader">
                <div>
                  <div className="title">Create pool</div>
                  <div className="sub">{`${token1Meta?.symbol || "\u2014"}/${token2Meta?.symbol || "\u2014"}`}</div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="swapTokenPill swapTokenPillBtn"
                    onClick={() => openTokenModal("t1")}
                    disabled={!!pendingTx}
                    title="Select token 1"
                    aria-label="Select token 1"
                  >
                    {token1Meta?.symbol || "\u2014"}
                  </button>
                  <button
                    type="button"
                    className="swapTokenPill swapTokenPillBtn"
                    onClick={() => openTokenModal("t2")}
                    disabled={!!pendingTx}
                    title="Select token 2"
                    aria-label="Select token 2"
                  >
                    {token2Meta?.symbol || "\u2014"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap" }}
                    onClick={() => {
                      if (pendingTx) return;
                      const a = token1Addr;
                      setToken1Addr(token2Addr);
                      setToken2Addr(a);
                    }}
                    disabled={!!pendingTx}
                    title="Flip tokens"
                    aria-label="Flip tokens"
                  >
                    {"\u2194"}
                  </button>
                </div>
              </div>

              <div className="swapBox">
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">Create pool</div>
                  <div className="swapTokenPill">{selectedPairKey || "\u2014"}</div>
                 </div>
                {sameTokenSelected ? (
                  <div className="small bad" style={{ marginTop: 8, opacity: 0.95 }}>
                    Select two different tokens.
                  </div>
                ) : bothNativeSelected ? (
                  <div className="small bad" style={{ marginTop: 8, opacity: 0.95 }}>
                    Select at least one ERC20 token.
                  </div>
                ) : (token1IsNative || token2IsNative) && !wrappedAddr ? (
                  <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                    Loading wrapped token...
                  </div>
                ) : (
                  <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                    Choose the amounts for both tokens. The router may use less and refund the excess to match the pool ratio.
                  </div>
                )}
              </div>

              <div className="swapBox" style={{ marginTop: 12 }}>
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">{`${token1Meta?.symbol || "\u2014"} amount`}</div>
                  <div className="swapTokenPill">{token1Meta?.symbol || "\u2014"}</div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={createAmt1Display}
                    onChange={(e) => {
                      setCreateAmt1(sanitizeAmountInput(e.target.value, token1Decimals));
                    }}
                    placeholder="0.0"
                    inputMode="decimal"
                    disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected}
                  />
                </div>
              </div>

              <div className="swapBox" style={{ marginTop: 12 }}>
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">{`${token2Meta?.symbol || "\u2014"} amount`}</div>
                  <div className="swapTokenPill">{token2Meta?.symbol || "\u2014"}</div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={createAmt2Display}
                    onChange={(e) => {
                      setCreateAmt2(sanitizeAmountInput(e.target.value, token2Decimals));
                    }}
                    placeholder="0.0"
                    inputMode="decimal"
                    disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected}
                  />
                </div>
              </div>

              <button
                type="button"
                className="btn swapCta"
                disabled={
                  !!pendingTx ||
                  !isSupportedChain ||
                  !dep?.router ||
                  sameTokenSelected ||
                  bothNativeSelected ||
                  ((token1IsNative || token2IsNative) && !wrappedAddr)
                }
                onClick={onCreatePoolWithDeposit}
              >
                {pendingTx ? "Pending transaction..." : "Create pool"}
              </button>

              {(createPoolStatus !== "Idle" || createPoolError) && (
                <div className={`swapStatus ${createPoolStatus === "Success" ? "ok" : createPoolStatus === "Failed" || createPoolError ? "bad" : "ok"}`}>
                  {createPoolError ? createPoolError : createPoolStatus}
                  {!!createPoolTx && (
                    <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                      Tx: {createPoolTx}
                    </div>
                  )}
                  {!!createPoolPairAddr && (
                    <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                      Pair: {createPoolPairAddr}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card swapCard" style={{ marginTop: 12 }}>
              <div className="cardHeader swapHeader">
                <div>
                  <div className="title">Pools</div>
                  <div className="sub">All pools (all pairs)</div>
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap" }}
                  onClick={refreshPools}
                  disabled={!!pendingTx}
                >
                  Refresh
                </button>
              </div>

              {!!pageError && <div className="swapStatus bad">{pageError}</div>}
              {pageStatus !== "Ready" && <div className="swapStatus ok">{pageStatus}</div>}
              {!isSupportedChain && chainId != null && <div className="swapStatus bad">Wrong network (chainId {chainId}).</div>}

              {(poolsStatus !== "Idle" || poolsError) && (
                <div className={`swapStatus ${poolsError ? "bad" : "ok"}`}>{poolsError ? poolsError : poolsStatus}</div>
              )}

              <div className="swapBox" style={{ marginTop: 12 }}>
                <div className="swapBoxHead" style={{ cursor: "pointer" }} onClick={() => setExpandedPoolId(isMainOpen ? "" : MAIN_POOL_ID)}>
                  <div className="swapBoxTitle">Main Pool</div>
                  <div className="swapTokenPill">{isMainOpen ? "Open" : "Closed"}</div>
                </div>

                <div className="small" style={{ marginTop: 8 }}>
                  Pair: <span className="kv">{poolExists ? pairAddr : "Not created yet"}</span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Reserves:{" "}
                  <span className="kv">
                    {sameTokenSelected || bothNativeSelected ? (
                      "\u2014"
                    ) : (
                      <>
                        {formatUnitsTrim(resToken1Raw, token1Decimals, 6)} {token1Meta?.symbol || "\u2014"} +{" "}
                        {formatUnitsTrim(resToken2Raw, token2Decimals, 6)} {token2Meta?.symbol || "\u2014"}
                      </>
                    )}
                  </span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Price:{" "}
                  <span className="kv">
                    {sameTokenSelected || bothNativeSelected
                      ? "\u2014"
                      : `1 ${token1Meta?.symbol || "token 1"} ~ ${price2Per1Text} ${token2Meta?.symbol || "token 2"}`}
                  </span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  LP totalSupply: <span className="kv">{lpTotalText}</span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Your LP balance: <span className="kv">{userLpText}</span>
                </div>

                {isMainOpen && (
                  <>
                    <div className="swapBox" style={{ marginTop: 12 }}>
                      <div className="swapBoxHead">
                        <div className="swapBoxTitle">{`${token1Meta?.symbol || "\u2014"} amount`}</div>
                        <div className="swapTokenPill">{token1Meta?.symbol || "\u2014"}</div>
                      </div>
                      <div className="swapBoxRow">
                        <input
                          className="input swapAmountInput"
                          value={addAmt1Display}
                          onChange={(e) => {
                            setAddAmt1(sanitizeAmountInput(e.target.value, token1Decimals));
                          }}
                          placeholder="0.0"
                          inputMode="decimal"
                          disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected}
                        />
                      </div>
                    </div>

                    <div className="swapBox" style={{ marginTop: 12 }}>
                      <div className="swapBoxHead">
                        <div className="swapBoxTitle">{`${token2Meta?.symbol || "\u2014"} amount`}</div>
                        <div className="swapTokenPill">{token2Meta?.symbol || "\u2014"}</div>
                      </div>
                      <div className="swapBoxRow">
                        <input
                          className="input swapAmountInput"
                          value={addAmt2Display}
                          onChange={(e) => {
                            setAddAmt2(sanitizeAmountInput(e.target.value, token2Decimals));
                          }}
                          placeholder="0.0"
                          inputMode="decimal"
                          disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn swapCta"
                      disabled={
                        !!pendingTx ||
                        !isSupportedChain ||
                        !dep?.router ||
                        sameTokenSelected ||
                        bothNativeSelected ||
                        ((token1IsNative || token2IsNative) && !wrappedAddr)
                      }
                      onClick={onAddLiquidity}
                    >
                      {pendingTx ? "Pending transaction..." : "Add Liquidity"}
                    </button>

                    {(addStatus !== "Idle" || addError) && (
                      <div className={`swapStatus ${addStatus === "Success" ? "ok" : addStatus === "Failed" || addError ? "bad" : "ok"}`}>
                        {addError ? addError : addStatus}
                        {!!addTx && (
                          <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                            Tx: {addTx}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="swapBox" style={{ marginTop: 12 }}>
                      <div className="swapBoxHead">
                        <div className="swapBoxTitle">LP to remove</div>
                        <div className="swapTokenPill">LP</div>
                      </div>
                      <div className="swapBoxRow" style={{ gap: 10 }}>
                        <input
                          className="input swapAmountInput"
                          value={removeLp}
                          onChange={(e) => setRemoveLp(sanitizeAmountInput(e.target.value, 18))}
                          placeholder="0.0"
                          inputMode="decimal"
                          disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap" }}
                          onClick={() => setRemoveLp(userLpText)}
                          disabled={!!pendingTx || userLpRaw <= 0n}
                        >
                          Max
                        </button>
                      </div>
                      <div className="small" style={{ marginTop: 8 }}>
                        Your LP: <span className="kv">{userLpText}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn swapCta"
                      disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected || !poolExists || userLpRaw <= 0n}
                      onClick={() => onRemoveLiquidity("")}
                    >
                      {pendingTx ? "Pending transaction..." : "Remove Liquidity"}
                    </button>

                    {(removeStatus !== "Idle" || removeError) && (
                      <div className={`swapStatus ${removeStatus === "Success" ? "ok" : removeStatus === "Failed" || removeError ? "bad" : "ok"}`}>
                        {removeError ? removeError : removeStatus}
                        {!!removeTx && (
                          <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                            Tx: {removeTx}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {(pools || []).map((p) => {
                const isOpen = expandedPoolId === p.id;
                const idShort = String(p.id || "").slice(-6).toUpperCase();
                const ownerShort = p?.owner ? `${String(p.owner).slice(0, 6)}...${String(p.owner).slice(-4)}` : "-";
                const poolPair = String(p?.pair || "");

                const poolToken0Symbol = String(p?.token0Symbol || (poolPair.includes("/") ? poolPair.split("/")[0] : "") || "").trim();
                const poolToken1Symbol = String(p?.token1Symbol || (poolPair.includes("/") ? poolPair.split("/")[1] : "") || "").trim();
                const poolToken0Address = String(p?.token0Address || "").trim();
                const poolToken1Address = String(p?.token1Address || "").trim();

                const poolTok0 =
                  (poolToken0Address && selectableTokens.find((t) => t?.address && sameAddr(t.address, poolToken0Address))) ||
                  (poolToken0Symbol && selectableTokens.find((t) => t?.symbol === poolToken0Symbol)) ||
                  null;
                const poolTok1 =
                  (poolToken1Address && selectableTokens.find((t) => t?.address && sameAddr(t.address, poolToken1Address))) ||
                  (poolToken1Symbol && selectableTokens.find((t) => t?.symbol === poolToken1Symbol)) ||
                  null;

                const poolTok0Label = poolTok0?.symbol || poolToken0Symbol || "token0";
                const poolTok1Label = poolTok1?.symbol || poolToken1Symbol || "token1";
                const poolTok0Decimals = poolTok0?.isNative ? 18 : Number(poolTok0?.decimals ?? 18);
                const poolTok1Decimals = poolTok1?.isNative ? 18 : Number(poolTok1?.decimals ?? 18);

                const poolMatchesSelected = (() => {
                  if (!token1Addr || !token2Addr) return false;
                  if (sameTokenSelected || bothNativeSelected) return false;

                  const sa = resolveOnchainAddr(token1Addr, token1IsNative);
                  const sb = resolveOnchainAddr(token2Addr, token2IsNative);
                  if (!sa || !sb) return false;

                  const pa = resolveOnchainAddr(poolToken0Address, poolToken0Address === "native");
                  const pb = resolveOnchainAddr(poolToken1Address, poolToken1Address === "native");
                  if (!pa || !pb) {
                    const sel = normalizePairKey(selectedPairKey);
                    const poolK = normalizePairKey(poolPair);
                    if (!sel || !poolK) return false;
                    const selRev = sel.includes("/") ? sel.split("/").reverse().join("/") : sel;
                    return poolK === sel || poolK === selRev;
                  }

                  return (sameAddr(sa, pa) && sameAddr(sb, pb)) || (sameAddr(sa, pb) && sameAddr(sb, pa));
                })();

                const total0Text = formatUnitsTrim(safeBigInt(p?.total0Raw ?? p?.totalBdagRaw), poolTok0Decimals, 6);
                const total1Text = formatUnitsTrim(safeBigInt(p?.total1Raw ?? p?.totalUsdcRaw), poolTok1Decimals, 6);
                const poolUserLpRaw = safeBigInt(p?.userLpRaw);
                const removableLpRaw = poolMatchesSelected ? (poolUserLpRaw < userLpRaw ? poolUserLpRaw : userLpRaw) : 0n;
                const removableLpText = formatUnitsTrim(removableLpRaw, 18, 18);

                return (
                  <div key={p.id} className="swapBox" style={{ marginTop: 12 }}>
                    <div className="swapBoxHead" style={{ cursor: "pointer" }} onClick={() => setExpandedPoolId(isOpen ? "" : p.id)}>
                      <div className="swapBoxTitle">{`Pool ${idShort || "-"}`}</div>
                      <div className="swapTokenPill">{isOpen ? "Open" : "Closed"}</div>
                    </div>

                    <div className="small" style={{ marginTop: 8 }}>
                      Owner: <span className="kv">{ownerShort}</span>
                    </div>
                    {!!poolPair && (
                      <div className="small" style={{ marginTop: 6 }}>
                        Pair: <span className="kv">{poolPair}</span>
                      </div>
                    )}
                    <div className="small" style={{ marginTop: 6 }}>
                      Activity: <span className="kv">{p.depositCount || 0}</span> - Total:{" "}
                      <span className="kv">
                        {total0Text} {poolTok0Label} + {total1Text} {poolTok1Label}
                      </span>
                    </div>

                    {isOpen && (
                      <>
                        {!poolMatchesSelected && !!poolPair && (
                          <div className="swapStatus bad" style={{ marginTop: 10 }}>
                            This pool uses {poolPair}. Switch token 1 / token 2 to match to manage liquidity.
                          </div>
                        )}
                        <div className="swapBox" style={{ marginTop: 12 }}>
                          <div className="swapBoxHead">
                            <div className="swapBoxTitle">{`${token1Meta?.symbol || "\u2014"} amount`}</div>
                            <div className="swapTokenPill">{token1Meta?.symbol || "\u2014"}</div>
                          </div>
                          <div className="swapBoxRow">
                              <input
                                className="input swapAmountInput"
                                value={poolAddAmt1Display}
                                onChange={(e) => {
                                  setPoolAddAmt1(sanitizeAmountInput(e.target.value, token1Decimals));
                                }}
                                placeholder="0.0"
                                inputMode="decimal"
                                disabled={
                                  !!pendingTx ||
                                  !isSupportedChain ||
                                  sameTokenSelected ||
                                  bothNativeSelected ||
                                  ((token1IsNative || token2IsNative) && !wrappedAddr) ||
                                  !poolMatchesSelected
                                }
                              />
                          </div>
                        </div>

                        <div className="swapBox" style={{ marginTop: 12 }}>
                          <div className="swapBoxHead">
                            <div className="swapBoxTitle">{`${token2Meta?.symbol || "\u2014"} amount`}</div>
                            <div className="swapTokenPill">{token2Meta?.symbol || "\u2014"}</div>
                          </div>
                          <div className="swapBoxRow">
                              <input
                                className="input swapAmountInput"
                                value={poolAddAmt2Display}
                                onChange={(e) => {
                                  setPoolAddAmt2(sanitizeAmountInput(e.target.value, token2Decimals));
                                }}
                                placeholder="0.0"
                                inputMode="decimal"
                                disabled={
                                  !!pendingTx ||
                                  !isSupportedChain ||
                                  sameTokenSelected ||
                                  bothNativeSelected ||
                                  ((token1IsNative || token2IsNative) && !wrappedAddr) ||
                                  !poolMatchesSelected
                                }
                              />
                            </div>
                        </div>

                        <button
                          type="button"
                          className="btn swapCta"
                          disabled={
                            !!pendingTx ||
                            !isSupportedChain ||
                            !dep?.router ||
                            sameTokenSelected ||
                            bothNativeSelected ||
                            ((token1IsNative || token2IsNative) && !wrappedAddr) ||
                            !poolMatchesSelected
                          }
                          onClick={() => onDepositToPool(p)}
                        >
                          {pendingTx ? "Pending transaction..." : "Add Liquidity"}
                        </button>

                        {(poolDepositStatus !== "Idle" || poolDepositError) && (
                          <div
                            className={`swapStatus ${
                              poolDepositStatus === "Success" ? "ok" : poolDepositStatus === "Failed" || poolDepositError ? "bad" : "ok"
                            }`}
                          >
                            {poolDepositError ? poolDepositError : poolDepositStatus}
                            {!!poolDepositTx && (
                              <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                                Tx: {poolDepositTx}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="swapBox" style={{ marginTop: 12 }}>
                          <div className="swapBoxHead">
                            <div className="swapBoxTitle">Remove Liquidity</div>
                            <div className="swapTokenPill">LP</div>
                          </div>
                          <div className="swapBoxRow" style={{ gap: 10 }}>
                            <input
                              className="input swapAmountInput"
                              value={removeLp}
                              onChange={(e) => setRemoveLp(sanitizeAmountInput(e.target.value, 18))}
                              placeholder="0.0"
                              inputMode="decimal"
                              disabled={!!pendingTx || !isSupportedChain || !poolMatchesSelected}
                            />
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap" }}
                              onClick={() => setRemoveLp(removableLpText)}
                              disabled={!!pendingTx || removableLpRaw <= 0n || !poolMatchesSelected}
                            >
                              Max
                            </button>
                          </div>
                          <div className="small" style={{ marginTop: 8 }}>
                            Your LP (this pool): <span className="kv">{removableLpText}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn swapCta"
                          disabled={!!pendingTx || !isSupportedChain || sameTokenSelected || bothNativeSelected || !poolExists || removableLpRaw <= 0n || !poolMatchesSelected}
                          onClick={() => onRemoveLiquidity(p.id)}
                        >
                          {pendingTx ? "Pending transaction..." : "Remove Liquidity"}
                        </button>

                        {(removeStatus !== "Idle" || removeError) && (
                          <div className={`swapStatus ${removeStatus === "Success" ? "ok" : removeStatus === "Failed" || removeError ? "bad" : "ok"}`}>
                            {removeError ? removeError : removeStatus}
                            {!!removeTx && (
                              <div className="small" style={{ opacity: 0.9, marginTop: 6, wordBreak: "break-word" }}>
                                Tx: {removeTx}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <TokenSelectModal
        open={isTokenModalOpen}
        tokens={selectableTokens}
        searchQuery={tokenSearchQuery}
        onSearchQueryChange={setTokenSearchQuery}
        onSelectToken={setTokenFromModal}
        onImportAddress={importTokenByAddress}
        onClose={closeTokenModal}
        balancesByAddress={{}}
      />
    </div>
  );
}
