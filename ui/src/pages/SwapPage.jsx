import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { createPortal } from "react-dom";
import TokenSelectModal from "../components/TokenSelectModal";

import { getBrowserProvider } from "../lib/eth";
import { TOKENS_1043 } from "../lib/tokens_1043";

const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)",
  "function getPair(address tokenA, address tokenB) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
];

const ROUTER_LITE2_ABI = [
  "function WETH() external view returns (address)",
  "function factory() external view returns (address)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
];

// Testnet is flaky on estimateGas. Force high gas limits for demo.
const GAS = {
  APPROVE: 600_000n,
  SWAP: 8_000_000n,
};

// Uniswap V2 formula (fee 0.30% => 997/1000)
function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

// Inverse of getAmountOut: amountIn required for desired amountOut (rounded up)
function getAmountIn(amountOut, reserveIn, reserveOut) {
  if (amountOut <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (amountOut >= reserveOut) return 0n;
  const numerator = reserveIn * amountOut * 1000n;
  const denominator = (reserveOut - amountOut) * 997n;
  return numerator / denominator + 1n;
}

function clampBps(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(5000, Math.floor(n))); // 0%..50%
}

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function sameAddr(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

function eip1193Code(e) {
  return e?.code ?? e?.data?.originalError?.code ?? e?.error?.code ?? null;
}

function compactDecStr(s, maxDecimals = 4) {
  if (!s) return "";
  const raw = String(s).trim();
  if (!raw) return "";

  const [intPartRaw, fracRaw = ""] = raw.split(".");
  const intPart = (intPartRaw || "0").replace(/^0+(?=\\d)/, "") || "0";
  if (intPart.length > 8) return `${intPart.slice(0, 8)}…`;

  const frac = fracRaw.slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
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

function formatUnitsTrim(raw, decimals, maxDecimals) {
  try {
    const s = ethers.formatUnits(raw ?? 0n, Number(decimals ?? 18));
    return trimDecimalsStr(s, maxDecimals);
  } catch {
    return "0";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isZeroAddr(a) {
  return !a || a.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

async function retryView(fn, retries = 3, delayMs = 350) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === retries - 1) throw last;
      await sleep(delayMs);
    }
  }
  throw last;
}

async function loadPairsInfo(provider, pairs) {
  const out = [];
  for (const pairAddr of pairs) {
    const pairC = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const [t0, t1, rs] = await Promise.all([
      retryView(() => pairC.token0()),
      retryView(() => pairC.token1()),
      retryView(() => pairC.getReserves()),
    ]);

    const tok0 = new ethers.Contract(t0, ERC20_ABI, provider);
    const tok1 = new ethers.Contract(t1, ERC20_ABI, provider);

    const [sym0, dec0, sym1, dec1] = await Promise.all([
      retryView(() => tok0.symbol()),
      retryView(() => tok0.decimals()),
      retryView(() => tok1.symbol()),
      retryView(() => tok1.decimals()),
    ]);

    out.push({
      pairAddr,
      token0: { addr: t0, symbol: sym0, decimals: Number(dec0) },
      token1: { addr: t1, symbol: sym1, decimals: Number(dec1) },
      reserves: { r0: rs.reserve0, r1: rs.reserve1 },
    });
  }
  return out;
}

export default function SwapPage({ account, chainId, dep, pendingTx, setPendingTx }) {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [netStatus, setNetStatus] = useState("");
  const [isNetBusy, setIsNetBusy] = useState(false);
  const [gasEstimateText, setGasEstimateText] = useState("—");

  // Persistent confirmation near Swap button
  const [confirm, setConfirm] = useState(null);
  // confirm = { type: 'success'|'fail', title: string, txHash?: string, details?: string }

  const [orderType, setOrderType] = useState("market"); // market|limit
  const [amount, setAmount] = useState("0.001"); // tokenIn input (string)
  const [amountOut, setAmountOut] = useState(""); // tokenOut input (string)
  const [amountLastEdited, setAmountLastEdited] = useState("in"); // in|out
  const [price, setPrice] = useState("0.0");

  const [tradeTab, setTradeTab] = useState("swap"); // swap|buy|sell

  // Wrapped address from router (WETH/WBDAG)
  const [wrappedAddr, setWrappedAddr] = useState("");
  const [routerFactoryAddr, setRouterFactoryAddr] = useState("");

  // Token selection (independent)
  const [tokenInAddr, setTokenInAddr] = useState("");
  const [tokenOutAddr, setTokenOutAddr] = useState("");

  // Token modal
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenModalTarget, setTokenModalTarget] = useState(null); // 'sell'|'buy'|null
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");

  // Settings popover
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const settingsAnchorRef = useRef(null);
  const settingsPopoverRef = useRef(null);
  const [settingsPos, setSettingsPos] = useState({ top: 0, left: 0 });

  const [slippageBpsInput, setSlippageBpsInput] = useState("");

  // Debug drawer
  const [debugOpen, setDebugOpen] = useState(false);

  // Pool + pair state (based on getPair(resolvedTokenIn, resolvedTokenOut))
  const [pairAddr, setPairAddr] = useState("");
  const [pairInfo, setPairInfo] = useState(null); // {pairAddr, token0, token1, reserves}
  const [pairLoadError, setPairLoadError] = useState("");

  // Modal balances (best-effort)
  const [balancesByAddr, setBalancesByAddr] = useState({});
  const [localTokens, setLocalTokens] = useState([]);

  const [routeRefreshNonce, setRouteRefreshNonce] = useState(0);

  const defaultSlippageBps = useMemo(() => {
    if (chainId === 1043) return 300; // 3%
    return 50; // 0.5%
  }, [chainId]);

  useEffect(() => {
    if (!slippageBpsInput) setSlippageBpsInput(String(defaultSlippageBps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSlippageBps]);

  const slippageBps = useMemo(() => {
    const n = Number(slippageBpsInput);
    if (!Number.isFinite(n)) return defaultSlippageBps;
    return clampBps(n);
  }, [slippageBpsInput, defaultSlippageBps]);

  const deadlineMinutes = 10;

  const tokenList = useMemo(() => {
    if (chainId === 1043) return TOKENS_1043;
    return localTokens;
  }, [chainId, localTokens]);

  const modalTokens = useMemo(() => {
    if (!tokenList?.length) return [];
    const list = [...tokenList];

    // Keep wrapped token address in sync with router.WETH() (WBDAG).
    const wrappedIndex = list.findIndex((t) => t.isWrapped);
    if (wrappedIndex >= 0 && wrappedAddr && !sameAddr(list[wrappedIndex].address, wrappedAddr)) {
      list[wrappedIndex] = { ...list[wrappedIndex], address: wrappedAddr };
    }

    return list;
  }, [tokenList, wrappedAddr]);

  const tokenMetaByAddr = useMemo(() => {
    const map = new Map();
    for (const t of modalTokens) map.set(String(t.address).toLowerCase(), t);
    return map;
  }, [modalTokens]);

  function getTokenMeta(addr) {
    if (!addr) return null;

    const lower = String(addr).toLowerCase();
    const t = tokenMetaByAddr.get(lower);
    if (t) {
      // Treat wrapped native (router.WETH()/WBDAG) as the "native" side for ETH-style swaps.
      const isNative = !!t.isNative || (!!wrappedAddr && sameAddr(t.address, wrappedAddr));
      return { ...t, isNative };
    }

    // Unknown token fallback (assume ERC20-like with 18 decimals, not native)
    return { symbol: shortAddr(addr), name: shortAddr(addr), address: addr, decimals: 18, isWrapped: false, isNative: false };
  }

  function isNativeAddr(addr) {
    const m = getTokenMeta(addr);
    return !!m?.isNative;
  }

  // Map UI-native BDAG -> wrappedAddr (WBDAG) for pool/quote/path (factory/pair/router ERC20 side).
  function resolveOnchainAddr(addr) {
    if (!addr) return "";
    if (isNativeAddr(addr)) return wrappedAddr || ""; // BDAG => WBDAG
    return addr;
  }

  const tokenInMeta = useMemo(() => getTokenMeta(tokenInAddr), [tokenInAddr, tokenMetaByAddr, wrappedAddr]);
  const tokenOutMeta = useMemo(() => getTokenMeta(tokenOutAddr), [tokenOutAddr, tokenMetaByAddr, wrappedAddr]);

  const sameTokenSelected = useMemo(() => {
    if (!tokenInAddr || !tokenOutAddr) return false;
    return sameAddr(tokenInAddr, tokenOutAddr);
  }, [tokenInAddr, tokenOutAddr]);

  // Reset confirmation when user changes inputs/tokens (so it doesn't stick forever)
  useEffect(() => {
    if (confirm) setConfirm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInAddr, tokenOutAddr, amount, tradeTab]);

  function closeTokenModal() {
    setIsTokenModalOpen(false);
    setTokenModalTarget(null);
    setTokenSearchQuery("");
  }

  function openTokenModal(target) {
    if (pendingTx) return;
    if (!tokenList?.length) return;
    setTokenModalTarget(target);
    setTokenSearchQuery("");
    setIsTokenModalOpen(true);
  }

  function setTokenFromModal(t) {
    if (!t) return;
    if (pendingTx) return;
    const nextAddr = t.address;

    if (tokenModalTarget === "sell" && tokenOutAddr && sameAddr(nextAddr, tokenOutAddr)) {
      setError("Select two different tokens");
      closeTokenModal();
      return;
    }
    if (tokenModalTarget === "buy" && tokenInAddr && sameAddr(nextAddr, tokenInAddr)) {
      setError("Select two different tokens");
      closeTokenModal();
      return;
    }

    if (tokenModalTarget === "sell") setTokenInAddr(nextAddr);
    if (tokenModalTarget === "buy") setTokenOutAddr(nextAddr);
    closeTokenModal();
  }

  useEffect(() => {
    if (!dep?.router) return;
    (async () => {
      try {
        const provider = await getBrowserProvider();
        const routerRO = new ethers.Contract(dep.router, ROUTER_LITE2_ABI, provider);
        const [w, f] = await Promise.all([retryView(() => routerRO.WETH()), retryView(() => routerRO.factory())]);
        setWrappedAddr(w);
        setRouterFactoryAddr(f);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [dep?.router]);

  // Default selection (testnet): default sell=wrapped, buy=TST (or first non-wrapped).
  useEffect(() => {
    if (chainId !== 1043) return;
    if (!wrappedAddr) return;

    const defOther = TOKENS_1043.find((t) => t.symbol === "TST") || TOKENS_1043.find((t) => !t.isWrapped);
    const defOtherAddr = defOther?.address || "";

    if (!tokenInAddr) setTokenInAddr(wrappedAddr);
    if (!tokenOutAddr) setTokenOutAddr(defOtherAddr);

    if (!tokenInAddr || !tokenOutAddr) return;
    if (sameAddr(tokenInAddr, tokenOutAddr)) {
      const alt = TOKENS_1043.find((t) => !t.isWrapped && !sameAddr(t.address, tokenInAddr));
      if (alt) setTokenOutAddr(alt.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, wrappedAddr]);

  // Local chain token discovery (best-effort): includes wrapped + the two tokens from pair0
  useEffect(() => {
    if (!chainId || chainId === 1043) return;
    if (!wrappedAddr) return;
    const factoryAddr = routerFactoryAddr || dep?.factory;
    if (!factoryAddr) return;

    let canceled = false;

    (async () => {
      try {
        const provider = await getBrowserProvider();
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);

        const tokens = [{ symbol: "WETH", name: "Wrapped Native", address: wrappedAddr, decimals: 18, isWrapped: true, isNative: false }];

        try {
          const nPairs = await retryView(() => factory.allPairsLength());
          const len = Number(nPairs);
          if (len > 0) {
            const p0 = await retryView(() => factory.allPairs(0));
            if (!isZeroAddr(p0)) {
              const pairC = new ethers.Contract(p0, PAIR_ABI, provider);
              const [t0, t1] = await Promise.all([retryView(() => pairC.token0()), retryView(() => pairC.token1())]);

              const tok0 = new ethers.Contract(t0, ERC20_ABI, provider);
              const tok1 = new ethers.Contract(t1, ERC20_ABI, provider);
              const [sym0, dec0, sym1, dec1] = await Promise.all([
                retryView(() => tok0.symbol()),
                retryView(() => tok0.decimals()),
                retryView(() => tok1.symbol()),
                retryView(() => tok1.decimals()),
              ]);

              tokens.push({ symbol: sym0, name: sym0, address: t0, decimals: Number(dec0), isWrapped: false, isNative: false });
              tokens.push({ symbol: sym1, name: sym1, address: t1, decimals: Number(dec1), isWrapped: false, isNative: false });
            }
          }
        } catch {}

        const uniq = [];
        const seen = new Set();
        for (const t of tokens) {
          const k = String(t.address).toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(t);
        }

        if (!canceled) setLocalTokens(uniq);

        if (!tokenInAddr && !canceled) setTokenInAddr(wrappedAddr);
        if (!tokenOutAddr && !canceled) {
          const other = uniq.find((t) => !t.isWrapped && !sameAddr(t.address, wrappedAddr));
          if (other) setTokenOutAddr(other.address);
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, wrappedAddr, routerFactoryAddr, dep?.factory]);

  // Settings popover position
  useEffect(() => {
    if (!isSettingsOpen) return;
    function updatePos() {
      const anchor = settingsAnchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(340, Math.max(260, Math.floor(window.innerWidth * 0.86)));
      const pad = 12;
      const left = Math.max(pad, Math.min(r.right - width, window.innerWidth - pad - width));
      const approxHeight = 320;
      const top = Math.max(pad, Math.min(r.bottom + 10, window.innerHeight - pad - approxHeight));
      setSettingsPos({ top, left });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isSettingsOpen]);

  // Settings popover close handlers
  useEffect(() => {
    if (!isSettingsOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setIsSettingsOpen(false);
    }
    function onMouseDown(e) {
      const wrap = settingsRef.current;
      const pop = settingsPopoverRef.current;
      const t = e.target;
      if (wrap && wrap.contains(t)) return;
      if (pop && pop.contains(t)) return;
      setIsSettingsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [isSettingsOpen]);

  // Pool detection + pair info load (IMPORTANT: uses resolved on-chain addresses)
  useEffect(() => {
    const factoryAddr = routerFactoryAddr || dep?.factory;
    if (!factoryAddr || !dep?.router) return;
    if (!wrappedAddr) return;

    if (!tokenInAddr || !tokenOutAddr || sameAddr(tokenInAddr, tokenOutAddr)) {
      setPairAddr("");
      setPairInfo(null);
      setPairLoadError("");
      return;
    }

    const a = resolveOnchainAddr(tokenInAddr);
    const b = resolveOnchainAddr(tokenOutAddr);

    // If user picked native and wrapped simultaneously, on-chain resolves to same token -> invalid route
    if (!a || !b || sameAddr(a, b)) {
      setPairAddr("");
      setPairInfo(null);
      setPairLoadError("");
      setStatus("Ready");
      return;
    }

    let canceled = false;

    async function loadPair() {
      if (pendingTx) return;
      setPairLoadError("");
      setError("");
      setStatus("Loading pool...");

      try {
        const provider = await getBrowserProvider();
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);

        const p = await retryView(() => factory.getPair(a, b));
        if (isZeroAddr(p)) {
          if (!canceled) {
            setPairAddr("");
            setPairInfo(null);
            setStatus("Ready");
          }
          return;
        }

        const infoArr = await loadPairsInfo(provider, [p]);
        const info = infoArr?.[0] || null;

        if (!canceled) {
          setPairAddr(p);
          setPairInfo(info);
          setStatus("Ready");
        }
      } catch (e) {
        console.error(e);
        if (!canceled) {
          setPairAddr("");
          setPairInfo(null);
          setPairLoadError("Quote unavailable");
          setStatus("Ready");
        }
      }
    }

    loadPair();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerFactoryAddr, dep?.factory, dep?.router, tokenInAddr, tokenOutAddr, routeRefreshNonce, pendingTx, wrappedAddr]);

  // Token modal balances (best-effort)
  useEffect(() => {
    if (!isTokenModalOpen) return;
    if (!account) return;
    if (!modalTokens?.length) return;

    let canceled = false;

    (async () => {
      try {
        const provider = await getBrowserProvider();
        const out = {};

        // Native balance once
        let nativeBal = null;
        try {
          nativeBal = await retryView(() => provider.getBalance(account));
        } catch {}

        for (const t of modalTokens) {
          const addr = String(t.address || "");
          const lower = addr.toLowerCase();

          const meta = getTokenMeta(addr);
          const isNative = !!meta?.isNative;

          try {
            let raw;
            if (isNative) raw = nativeBal ?? 0n;
            else {
              const c = new ethers.Contract(addr, ERC20_ABI, provider);
              raw = await retryView(() => c.balanceOf(account));
            }

            const dec = Number(meta?.decimals ?? t.decimals ?? 18);
            const s = ethers.formatUnits(raw, dec);
            out[lower] = s;
          } catch {
            out[lower] = "";
          }
        }

        if (!canceled) setBalancesByAddr(out);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTokenModalOpen, account, modalTokens, wrappedAddr]);

  // Selected token balances (best-effort)
  useEffect(() => {
    if (!account) return;
    if (!tokenInAddr && !tokenOutAddr) return;

    let canceled = false;

    (async () => {
      try {
        const provider = await getBrowserProvider();

        let nativeBal = null;
        try {
          nativeBal = await retryView(() => provider.getBalance(account));
        } catch {}

        const items = [
          { addr: tokenInAddr, meta: tokenInMeta },
          { addr: tokenOutAddr, meta: tokenOutMeta },
        ].filter((x) => !!x.addr);

        const out = {};

        for (const it of items) {
          const addr = String(it.addr || "");
          const lower = addr.toLowerCase();
          const meta = it.meta;

          try {
            let raw;
            if (meta?.isNative) raw = nativeBal ?? 0n;
            else {
              const c = new ethers.Contract(addr, ERC20_ABI, provider);
              raw = await retryView(() => c.balanceOf(account));
            }

            const dec = Number(meta?.decimals ?? 18);
            out[lower] = ethers.formatUnits(raw, dec);
          } catch {
            out[lower] = "";
          }
        }

        if (!canceled) {
          setBalancesByAddr((prev) => ({ ...prev, ...out }));
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, tokenInAddr, tokenOutAddr, tokenInMeta, tokenOutMeta, wrappedAddr]);

  // Pool missing logic: uses resolved on-chain addresses
  const poolMissing = useMemo(() => {
    if (!tokenInAddr || !tokenOutAddr) return false;
    if (sameTokenSelected) return false;

    if (!wrappedAddr) return true;
    const a = resolveOnchainAddr(tokenInAddr);
    const b = resolveOnchainAddr(tokenOutAddr);
    if (!a || !b) return true;
    if (sameAddr(a, b)) return true;

    return !pairAddr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInAddr, tokenOutAddr, sameTokenSelected, pairAddr, wrappedAddr]);

  // Quote uses resolved path and pair reserves
  const quote = useMemo(() => {
    if (!orderType || orderType !== "market") return null;
    if (!pairAddr || !pairInfo?.reserves || !pairInfo?.token0 || !pairInfo?.token1) return null;
    if (!tokenInMeta || !tokenOutMeta) return null;
    if (!wrappedAddr) return null;

    const a = resolveOnchainAddr(tokenInAddr);
    const b = resolveOnchainAddr(tokenOutAddr);
    if (!a || !b || sameAddr(a, b)) return null;

    let amountInRaw = 0n;
    if (amountLastEdited !== "out") {
      try {
        amountInRaw = ethers.parseUnits(amount || "0", Number(tokenInMeta.decimals ?? 18));
      } catch {
        amountInRaw = 0n;
      }
      if (amountInRaw <= 0n) return null;
    }

    const token0IsIn = sameAddr(pairInfo.token0.addr, a);
    const token1IsIn = sameAddr(pairInfo.token1.addr, a);
    if (!token0IsIn && !token1IsIn) return null;

    const reserveIn = token0IsIn ? pairInfo.reserves.r0 : pairInfo.reserves.r1;
    const reserveOut = token0IsIn ? pairInfo.reserves.r1 : pairInfo.reserves.r0;

    let outRaw = 0n;
    let minOutRaw = 0n;

    if (amountLastEdited === "out") {
      let desiredOutRaw = 0n;
      try {
        desiredOutRaw = ethers.parseUnits(amountOut || "0", Number(tokenOutMeta.decimals ?? 18));
      } catch {
        desiredOutRaw = 0n;
      }
      if (desiredOutRaw <= 0n) return null;

      amountInRaw = getAmountIn(desiredOutRaw, reserveIn, reserveOut);
      if (amountInRaw <= 0n) return null;

      outRaw = getAmountOut(amountInRaw, reserveIn, reserveOut);
      if (outRaw <= 0n) return null;

      // In "out-edited" mode we treat the user-entered amount as minimum received.
      minOutRaw = desiredOutRaw;
    } else {
      outRaw = getAmountOut(amountInRaw, reserveIn, reserveOut);
      if (outRaw <= 0n) return null;
      minOutRaw = (outRaw * (10000n - BigInt(clampBps(slippageBps)))) / 10000n;
    }

    return { amountInRaw, outRaw, minOutRaw, pathResolved: [a, b] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderType,
    pairAddr,
    pairInfo,
    tokenInMeta,
    tokenOutMeta,
    amount,
    amountOut,
    amountLastEdited,
    slippageBps,
    tokenInAddr,
    tokenOutAddr,
    wrappedAddr,
  ]);

  const tokenInDecimals = Number(tokenInMeta?.decimals ?? 18);
  const tokenOutDecimals = Number(tokenOutMeta?.decimals ?? 18);

  const sellDisplay = useMemo(() => {
    if (amountLastEdited === "out") {
      if (!quote?.amountInRaw) return "0";
      return formatUnitsTrim(quote.amountInRaw, tokenInDecimals, Math.min(8, tokenInDecimals));
    }
    return amount;
  }, [amountLastEdited, quote?.amountInRaw, tokenInDecimals, amount]);

  const buyDisplay = useMemo(() => {
    if (amountLastEdited === "out") return amountOut;
    if (!quote?.outRaw) return "";
    return formatUnitsTrim(quote.outRaw, tokenOutDecimals, Math.min(8, tokenOutDecimals));
  }, [amountLastEdited, amountOut, quote?.outRaw, tokenOutDecimals]);

  const quoteText = useMemo(() => {
    if (!tokenInAddr || !tokenOutAddr) return "\u2014";
    if (sameTokenSelected) return "\u2014";
    if (poolMissing) return "\u2014";
    if (pairLoadError) return "Quote unavailable";
    if (!quote) return "\u2014";
    try {
      return `${ethers.formatUnits(quote.outRaw, Number(tokenOutMeta?.decimals ?? 18))} ${tokenOutMeta?.symbol || "TOKEN"}`;
    } catch {
      return "Quote unavailable";
    }
  }, [tokenInAddr, tokenOutAddr, sameTokenSelected, poolMissing, pairLoadError, quote, tokenOutMeta]);

  const minOutText = useMemo(() => {
    if (!quote) return "\u2014";
    try {
      return `${ethers.formatUnits(quote.minOutRaw, Number(tokenOutMeta?.decimals ?? 18))} ${tokenOutMeta?.symbol || "TOKEN"}`;
    } catch {
      return "\u2014";
    }
  }, [quote, tokenOutMeta]);

  const inlineWarning = useMemo(() => {
    if (!tokenInAddr || !tokenOutAddr) return "";
    if (sameTokenSelected) return "Select two different tokens";

    const a = resolveOnchainAddr(tokenInAddr);
    const b = resolveOnchainAddr(tokenOutAddr);
    if (wrappedAddr && a && b && sameAddr(a, b)) return "Invalid route (native and wrapped are equivalent)";

    if (poolMissing) return "Pool doesn't exist for this pair.";
    if (pairLoadError) return "Quote unavailable";
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInAddr, tokenOutAddr, sameTokenSelected, poolMissing, pairLoadError, wrappedAddr]);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (poolMissing || pairLoadError) {
        if (alive) setGasEstimateText("Unable to estimate");
        return;
      }
      if (!quote) {
        if (alive) setGasEstimateText("—");
        return;
      }
      if (!account || !dep?.router) {
        if (alive) setGasEstimateText("Unable to estimate");
        return;
      }

      try {
        const provider = await getBrowserProvider();
        const signer = await provider.getSigner();
        const router = new ethers.Contract(dep.router, ROUTER_LITE2_ABI, signer);

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * deadlineMinutes);
        const path = quote.pathResolved;

        let gasLimit;
        if (tokenInMeta?.isNative) {
          gasLimit = await router.swapExactETHForTokens.estimateGas(quote.minOutRaw, path, account, deadline, {
            value: quote.amountInRaw,
          });
        } else if (tokenOutMeta?.isNative) {
          gasLimit = await router.swapExactTokensForETH.estimateGas(
            quote.amountInRaw,
            quote.minOutRaw,
            path,
            account,
            deadline
          );
        } else {
          gasLimit = await router.swapExactTokensForTokens.estimateGas(
            quote.amountInRaw,
            quote.minOutRaw,
            path,
            account,
            deadline
          );
        }

        const feeData = await provider.getFeeData();
        const gasPrice = feeData?.gasPrice ?? feeData?.maxFeePerGas ?? null;
        if (!gasPrice) throw new Error("Missing gasPrice");

        const costWei = gasLimit * gasPrice;
        const cost = Number(ethers.formatEther(costWei));
        if (!Number.isFinite(cost)) throw new Error("Bad cost");

        const decimals = cost < 0.01 ? 6 : 4;
        const text = `~${cost.toFixed(decimals)} BDAG`;
        if (alive) setGasEstimateText(text);
      } catch {
        if (alive) setGasEstimateText("Unable to estimate");
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [quote, poolMissing, pairLoadError, dep?.router, account, tokenInMeta?.isNative, tokenOutMeta?.isNative, deadlineMinutes]);

  const primaryDisabled =
    !!pendingTx ||
    !dep ||
    !account ||
    !tokenInAddr ||
    !tokenOutAddr ||
    sameTokenSelected ||
    poolMissing ||
    !!pairLoadError ||
    (orderType === "market" && (!quote || quote.amountInRaw <= 0n));

  const primaryText = pendingTx ? `Pending... ${shortAddr(pendingTx)}` : "Swap";

  function setTab(next) {
    setTradeTab(next);
    setOrderType("market");

    if (!wrappedAddr) return;
    const other =
      tokenList.find((t) => !t.isWrapped && !sameAddr(t.address, wrappedAddr)) || TOKENS_1043.find((t) => !t.isWrapped);

    if (next === "buy") {
      setTokenInAddr(wrappedAddr);
      if (other?.address) setTokenOutAddr(other.address);
    }
    if (next === "sell") {
      if (other?.address) setTokenInAddr(other.address);
      setTokenOutAddr(wrappedAddr);
    }
  }

  async function addOrSwitchBlockdagNetwork() {
    if (isNetBusy) return;

    const eth = window?.ethereum;
    if (!eth?.request) {
      setNetStatus("No wallet detected");
      return;
    }

    const chainIdHex = "0x413"; // 1043

    try {
      setIsNetBusy(true);
      setNetStatus("Switching...");

      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
        setNetStatus("Switched");
        return;
      } catch (e) {
        const code = eip1193Code(e);
        if (code === 4001) {
          setNetStatus("User rejected");
          return;
        }
        if (code !== 4902) throw e;
      }

      const rpcUrl = String(import.meta.env.VITE_RPC_URL || "").trim();
      if (!rpcUrl) {
        setNetStatus("Missing VITE_RPC_URL");
        return;
      }

      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: "BlockDAG Testnet",
            nativeCurrency: { name: "BlockDAG", symbol: "BDAG", decimals: 18 },
            rpcUrls: [rpcUrl],
          },
        ],
      });

      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });

      setNetStatus("Switched");
    } catch (e) {
      const code = eip1193Code(e);
      if (code === 4001) setNetStatus("User rejected");
      else setNetStatus(toErr(e));
    } finally {
      setIsNetBusy(false);
    }
  }

  async function placeMarket() {
    if (pendingTx) return;

    if (!dep?.router) return setError("Router not loaded");
    if (!account) return setError("Wallet not connected");
    if (!wrappedAddr) return setError("Wrapped token not loaded");
    if (sameTokenSelected) return setError("Select two different tokens");

    setError("");
    setConfirm(null);

    const inMeta = tokenInMeta;
    const outMeta = tokenOutMeta;
    const isInNative = !!inMeta?.isNative;
    const isOutNative = !!outMeta?.isNative;

    const a = resolveOnchainAddr(tokenInAddr);
    const b = resolveOnchainAddr(tokenOutAddr);
    if (!a || !b || sameAddr(a, b)) return setError("Invalid route");

    if (poolMissing) return setError("Pool doesn't exist for this pair.");
    if (pairLoadError || !quote) return setError("Quote unavailable");
    if (!quote || quote.amountInRaw <= 0n) return setError("Invalid amount");

    try {
      setStatus("Preparing tx...");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const router = new ethers.Contract(dep.router, ROUTER_LITE2_ABI, signer);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * deadlineMinutes);
      const path = quote.pathResolved;

      if (isInNative && !sameAddr(path[0], wrappedAddr)) return setError("Bad path (expected wrapped in)");
      if (isOutNative && !sameAddr(path[path.length - 1], wrappedAddr)) return setError("Bad path (expected wrapped out)");

      let tx;

      if (isInNative) {
        setStatus("Sending swapExactETHForTokens...");
        tx = await router.swapExactETHForTokens(quote.minOutRaw, path, account, deadline, {
          value: quote.amountInRaw,
          gasLimit: GAS.SWAP,
        });
      } else if (isOutNative) {
        const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, signer);

        setStatus("Checking allowance...");
        const allowance = await tokenIn.allowance(account, dep.router);
        if (allowance < quote.amountInRaw) {
          setStatus("Approving token...");
          const txA = await tokenIn.approve(dep.router, quote.amountInRaw, { gasLimit: GAS.APPROVE });
          setPendingTx(txA.hash);
          setStatus(`Approve pending: ${txA.hash}`);
          await txA.wait();
          setPendingTx("");
        }

        setStatus("Sending swapExactTokensForETH...");
        tx = await router.swapExactTokensForETH(quote.amountInRaw, quote.minOutRaw, path, account, deadline, {
          gasLimit: GAS.SWAP,
        });
      } else {
        const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, signer);

        setStatus("Checking allowance...");
        const allowance = await tokenIn.allowance(account, dep.router);
        if (allowance < quote.amountInRaw) {
          setStatus("Approving token...");
          const txA = await tokenIn.approve(dep.router, quote.amountInRaw, { gasLimit: GAS.APPROVE });
          setPendingTx(txA.hash);
          setStatus(`Approve pending: ${txA.hash}`);
          await txA.wait();
          setPendingTx("");
        }

        setStatus("Sending swapExactTokensForTokens...");
        tx = await router.swapExactTokensForTokens(quote.amountInRaw, quote.minOutRaw, path, account, deadline, {
          gasLimit: GAS.SWAP,
        });
      }

      setPendingTx(tx.hash);
      setStatus(`Pending: ${tx.hash}`);

      const rc = await tx.wait();

      setPendingTx("");
      setRouteRefreshNonce((n) => n + 1);

      if (rc?.status === 1) {
        setConfirm({
          type: "success",
          title: "Swap success ✅",
          txHash: tx.hash,
          details: "Transaction confirmed on-chain.",
        });
      } else {
        setConfirm({
          type: "fail",
          title: "Swap failed ❌",
          txHash: tx.hash,
          details: "Transaction was mined but failed.",
        });
      }

      setStatus("Ready");
    } catch (e) {
      console.error(e);
      const msg = toErr(e);
      setError(msg);
      setConfirm({
        type: "fail",
        title: "Swap failed ❌",
        details: msg,
      });
      setStatus("Ready");
      setPendingTx("");
      setRouteRefreshNonce((n) => n + 1);
    }
  }

  const tokenInSymbol = tokenInMeta?.symbol || "\u2014";
  const tokenOutSymbol = tokenOutMeta?.symbol || "\u2014";

  const tokenInBalShort = useMemo(() => {
    if (!account || !tokenInAddr) return "";
    const s = balancesByAddr[String(tokenInAddr).toLowerCase()] || "";
    return compactDecStr(s, 4);
  }, [account, tokenInAddr, balancesByAddr]);

  const tokenOutBalShort = useMemo(() => {
    if (!account || !tokenOutAddr) return "";
    const s = balancesByAddr[String(tokenOutAddr).toLowerCase()] || "";
    return compactDecStr(s, 4);
  }, [account, tokenOutAddr, balancesByAddr]);

  // Debug: resolved on-chain tokens
  const resolvedA = useMemo(() => resolveOnchainAddr(tokenInAddr), [tokenInAddr, wrappedAddr, tokenMetaByAddr]);
  const resolvedB = useMemo(() => resolveOnchainAddr(tokenOutAddr), [tokenOutAddr, wrappedAddr, tokenMetaByAddr]);

  return (
    <>
      <div className="container">
        <div className="swapShell">
          <div className="card swapCard">
            <div className="cardHeader swapHeader">
              <div className="swapTabs">
                <button className={`swapTab ${tradeTab === "swap" ? "swapTabActive" : ""}`} onClick={() => setTab("swap")}>
                  Swap
                </button>
              </div>

              <div className="swapHeaderRight">
                {tradeTab === "swap" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      className="swapTokenPill swapTokenPillBtn"
                      disabled={chainId === 1043 || isNetBusy}
                      onClick={() => {
                        if (chainId === 1043) return;
                        setNetStatus("");
                        addOrSwitchBlockdagNetwork();
                      }}
                      aria-label={chainId === 1043 ? "BlockDAG active" : "Add BlockDAG Network"}
                      title={chainId === 1043 ? "BlockDAG active" : "Add BlockDAG Network"}
                    >
                      {chainId === 1043 ? "BlockDAG active" : "Add BlockDAG Network"}
                    </button>
                    {!!netStatus && (
                      <span className="small" style={{ opacity: 0.85, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {netStatus}
                      </span>
                    )}
                  </div>
                )}

                <div className="settingsWrap" ref={settingsRef}>
                  <button
                    type="button"
                    className="swapGearBtn"
                    ref={settingsAnchorRef}
                    onClick={() => {
                      if (pendingTx) return;
                      setIsSettingsOpen((v) => !v);
                    }}
                    aria-label="Settings"
                    title="Settings"
                    disabled={!!pendingTx}
                  >
                    {"\u2699"}
                  </button>
                </div>
              </div>
            </div>

            <>
              <div className="swapBox">
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">Sell</div>
                  <div className="swapTokenPick">
                    {!!tokenInBalShort && <span className="swapTokenBalOutside">{tokenInBalShort}</span>}
                    <button
                      type="button"
                      className="swapTokenPill swapTokenPillBtn"
                      onClick={() => openTokenModal("sell")}
                      aria-label="Select sell token"
                      aria-disabled={!!pendingTx}
                      title={pendingTx ? "Transaction pending" : "Select a token"}
                    >
                      {tokenInSymbol}
                    </button>
                  </div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={sellDisplay}
                    onChange={(e) => {
                      if (pendingTx) return;
                      setAmountLastEdited("in");
                      setAmount(sanitizeAmountInput(e.target.value, tokenInDecimals));
                    }}
                    disabled={!!pendingTx}
                    inputMode="decimal"
                  />
                </div>
              </div>

              <button
                className="swapArrow"
                onClick={() => {
                  if (pendingTx) return;
                  const a = tokenInAddr;
                  const b = tokenOutAddr;
                  setTokenInAddr(b);
                  setTokenOutAddr(a);
                  setTradeTab("swap");
                  setOrderType("market");
                  setAmountLastEdited("in");
                  setAmountOut("");
                }}
                title="Flip direction"
                type="button"
                disabled={!!pendingTx}
              >
                {"\u2193"}
              </button>

              <div className="swapBox">
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">Buy</div>
                  <div className="swapTokenPick">
                    {!!tokenOutBalShort && <span className="swapTokenBalOutside">{tokenOutBalShort}</span>}
                    <button
                      type="button"
                      className="swapTokenPill swapTokenPillBtn"
                      onClick={() => openTokenModal("buy")}
                      aria-label="Select buy token"
                      aria-disabled={!!pendingTx}
                      title={pendingTx ? "Transaction pending" : "Select a token"}
                    >
                      {tokenOutSymbol}
                    </button>
                  </div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={buyDisplay}
                    onChange={(e) => {
                      if (pendingTx) return;
                      setAmountLastEdited("out");
                      setAmountOut(sanitizeAmountInput(e.target.value, tokenOutDecimals));
                    }}
                    disabled={!!pendingTx}
                    inputMode="decimal"
                  />
                </div>
                {!!inlineWarning && (
                  <div className="small bad" style={{ marginTop: 8 }}>
                    {inlineWarning}
                  </div>
                )}
                <div className="swapMeta small">
                  MinOut{amountLastEdited === "out" ? " (exact)" : ` (${(clampBps(slippageBps) / 100).toFixed(2)}%)`}: <b>{minOutText}</b>
                </div>
              </div>
            </>

            <button
              className="btn swapCta"
              disabled={primaryDisabled}
              onClick={() => {
                return placeMarket();
              }}
            >
              {primaryText}
            </button>

            <div className="detailsPanel" style={{ marginTop: 10 }}>
              <div className="settingsTitle" style={{ marginBottom: 8 }}>
                Swap summary
              </div>
              <div className="detailsRow">
                <div className="small">Expected output</div>
                <div className="kv">{quote ? quoteText : "—"}</div>
              </div>
              <div className="detailsRow">
                <div className="small">Slippage limit</div>
                <div className="kv">{(slippageBps / 100).toFixed(2)}%</div>
              </div>
              <div className="detailsRow">
                <div className="small">Minimum received</div>
                <div className="kv">{quote ? minOutText : "—"}</div>
              </div>
              <div className="detailsRow">
                <div className="small">Estimated gas</div>
                <div className="kv">{gasEstimateText}</div>
              </div>
            </div>

            {/* NOW: confirmation is right under the Swap button */}
            {confirm && (
              <div
                className={`swapStatus ${confirm.type === "success" ? "ok" : "bad"}`}
                style={{ marginTop: 10, cursor: confirm.txHash ? "pointer" : "default" }}
                onClick={() => {
                  if (!confirm?.txHash) return;
                  try {
                    navigator.clipboard.writeText(confirm.txHash);
                    setConfirm((c) => (c ? { ...c, details: "Tx hash copied." } : c));
                  } catch {}
                }}
                title={confirm.txHash ? "Click to copy tx hash" : ""}
              >
                <div style={{ fontWeight: 700 }}>{confirm.title}</div>
                {confirm.txHash && <div className="small">Tx: {confirm.txHash}</div>}
                {confirm.details && (
                  <div className="small" style={{ opacity: 0.92, marginTop: 4 }}>
                    {confirm.details}
                  </div>
                )}
              </div>
            )}

            <div className={`swapStatus ${error ? "bad" : "ok"}`}>{error ? error : status}</div>

            <button
              type="button"
              className="detailsToggle"
              onClick={() => {
                if (pendingTx) return;
                setDebugOpen((v) => !v);
              }}
              aria-expanded={debugOpen}
              disabled={!!pendingTx}
            >
              Debug {debugOpen ? "\u25B4" : "\u25BE"}
            </button>

            {debugOpen && (
              <div className="detailsPanel">
                <div className="detailsRow">
                  <div className="small">chainId</div>
                  <div className="kv">{chainId ?? "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">factory</div>
                  <div className="kv">{routerFactoryAddr || dep?.factory || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">router</div>
                  <div className="kv">{dep?.router || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">wrapped</div>
                  <div className="kv">{wrappedAddr || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">tokenIn</div>
                  <div className="kv">
                    {tokenInAddr || "\u2014"} {tokenInMeta?.isNative ? "(native)" : ""}
                  </div>
                </div>

                <div className="detailsRow">
                  <div className="small">tokenOut</div>
                  <div className="kv">
                    {tokenOutAddr || "\u2014"} {tokenOutMeta?.isNative ? "(native)" : ""}
                  </div>
                </div>

                <div className="detailsRow">
                  <div className="small">resolvedIn</div>
                  <div className="kv">{resolvedA || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">resolvedOut</div>
                  <div className="kv">{resolvedB || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">pair</div>
                  <div className="kv">{pairAddr || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">pool</div>
                  <div className="kv">
                    {!tokenInAddr || !tokenOutAddr
                      ? "\u2014"
                      : sameTokenSelected
                      ? "Select two different tokens"
                      : resolvedA && resolvedB && sameAddr(resolvedA, resolvedB)
                      ? "Invalid route"
                      : pairAddr
                      ? "Pool OK"
                      : "Pool missing"}
                  </div>
                </div>

                <div className="detailsRow">
                  <div className="small">pairError</div>
                  <div className="kv">{pairLoadError || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">token0</div>
                  <div className="kv">{pairInfo?.token0?.addr || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">token1</div>
                  <div className="kv">{pairInfo?.token1?.addr || "\u2014"}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">reserves</div>
                  <div className="kv">
                    {pairInfo?.reserves ? `${pairInfo.reserves.r0.toString()} / ${pairInfo.reserves.r1.toString()}` : "\u2014"}
                  </div>
                </div>

                <div className="detailsRow">
                  <div className="small">slippageBps</div>
                  <div className="kv">{clampBps(slippageBps)}</div>
                </div>

                <div className="detailsRow">
                  <div className="small">lastError</div>
                  <div className="kv">{error || "\u2014"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <TokenSelectModal
        open={isTokenModalOpen}
        tokens={modalTokens}
        searchQuery={tokenSearchQuery}
        onSearchQueryChange={setTokenSearchQuery}
        onSelectToken={setTokenFromModal}
        onClose={closeTokenModal}
        balancesByAddress={balancesByAddr}
      />

      {isSettingsOpen &&
        createPortal(
          <div
            ref={settingsPopoverRef}
            className="card settingsPopover"
            role="dialog"
            aria-label="Swap settings"
            style={{ top: `${settingsPos.top}px`, left: `${settingsPos.left}px` }}
          >
            <div className="settingsTitle">Settings</div>

            <div className="settingsRow">
              <div className="small" style={{ opacity: 0.92 }}>
                Slippage (bps)
              </div>
              <div className="settingsControls">
                <input
                  className="input settingsInput"
                  value={slippageBpsInput}
                  onChange={(e) => setSlippageBpsInput(e.target.value)}
                  inputMode="numeric"
                  aria-label="Slippage in bps"
                />
                <div className="small" style={{ opacity: 0.85 }}>
                  {`${(clampBps(slippageBps) / 100).toFixed(2)}%`}
                </div>
              </div>
              <div className="small" style={{ opacity: 0.85 }}>
                Range: 0-5000 bps
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
