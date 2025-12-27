import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import { loadDeployments } from "../lib/deployments";
import { getBrowserProvider, hasInjected, requestAccounts } from "../lib/eth";
import { TOKENS_1043 } from "../lib/tokens_1043";

const CHAIN_ID = 1043;
const MAIN_POOL_ID = "__main__";

const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address)"];

const PAIR_ABI = [
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function transfer(address to, uint256 value) external returns (bool)",
  "function burn(address to) external returns (uint256 amount0, uint256 amount1)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
];

const ROUTER_ABI = [
  "function WETH() external view returns (address)",
  "function factory() external view returns (address)",
  "function addLiquidityETH((address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) p) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)",
];

// Testnet is flaky on estimateGas. Force high gas limits for demo.
const GAS = {
  APPROVE: 600_000n,
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

  const [wusdcDecimals, setWusdcDecimals] = useState(6);

  const [pairAddr, setPairAddr] = useState("");
  const [resWbdagRaw, setResWbdagRaw] = useState(0n);
  const [resUsdcRaw, setResUsdcRaw] = useState(0n);
  const [lpTotalSupplyRaw, setLpTotalSupplyRaw] = useState(0n);
  const [userLpRaw, setUserLpRaw] = useState(0n);

  const [refreshNonce, setRefreshNonce] = useState(0);

  const [addBdag, setAddBdag] = useState("0.1");
  const [addUsdc, setAddUsdc] = useState("");
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

  const [createBdag, setCreateBdag] = useState("0.1");
  const [createUsdc, setCreateUsdc] = useState("");
  const [createPoolStatus, setCreatePoolStatus] = useState("Idle");
  const [createPoolError, setCreatePoolError] = useState("");
  const [createPoolTx, setCreatePoolTx] = useState("");

  const [poolAddBdag, setPoolAddBdag] = useState("0.1");
  const [poolAddUsdc, setPoolAddUsdc] = useState("");
  const [poolDepositStatus, setPoolDepositStatus] = useState("Idle");
  const [poolDepositError, setPoolDepositError] = useState("");
  const [poolDepositTx, setPoolDepositTx] = useState("");

  const walletOk = hasInjected();

  const wusdcAddr = useMemo(() => {
    const t = (TOKENS_1043 || []).find((x) => x.symbol === "WUSDC");
    if (!t?.address) return null;
    return t.address;
  }, []);

  const isSupportedChain = chainId === CHAIN_ID;

  useEffect(() => {
    const t = (TOKENS_1043 || []).find((x) => x.symbol === "WUSDC");
    if (!t) return;
    setWusdcDecimals(Number(t.decimals ?? 6));
  }, []);

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

  // Read WUSDC decimals from chain (best-effort)
  useEffect(() => {
    if (!isSupportedChain) return;
    if (!walletOk) return;
    if (!wusdcAddr) return;

    let canceled = false;

    (async () => {
      try {
        const provider = await getBrowserProvider();
        const token = new ethers.Contract(wusdcAddr, ERC20_ABI, provider);
        const d = await retryView(() => token.decimals());
        if (!canceled) setWusdcDecimals(Number(d));
      } catch {}
    })();

    return () => {
      canceled = true;
    };
  }, [isSupportedChain, walletOk, wusdcAddr]);

  // Load pair + reserves + LP balances
  useEffect(() => {
    if (!isSupportedChain) return;
    if (!factoryAddr) return;
    if (!wrappedAddr) return;
    if (!wusdcAddr) return;

    let canceled = false;

    (async () => {
      setPageError("");
      setPageStatus("Loading pool...");

      try {
        const provider = await getBrowserProvider();
        const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
        const p = await retryView(() => factory.getPair(wrappedAddr, wusdcAddr));

        if (canceled) return;
        setPairAddr(p);

        if (isZeroAddr(p)) {
          setResWbdagRaw(0n);
          setResUsdcRaw(0n);
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

        let rw = 0n;
        let ru = 0n;
        if (sameAddr(t0, wrappedAddr) && sameAddr(t1, wusdcAddr)) {
          rw = r0;
          ru = r1;
        } else if (sameAddr(t1, wrappedAddr) && sameAddr(t0, wusdcAddr)) {
          rw = r1;
          ru = r0;
        }

        if (!canceled) {
          setResWbdagRaw(rw);
          setResUsdcRaw(ru);
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
  }, [account, isSupportedChain, factoryAddr, wrappedAddr, wusdcAddr, refreshNonce, pendingTx]);

  const poolExists = !!pairAddr && !isZeroAddr(pairAddr);
  const reservesNonZero = resWbdagRaw > 0n && resUsdcRaw > 0n;
  const isAutoQuote = poolExists && reservesNonZero;

  const addBdagRaw = useMemo(() => parseUnitsSafe(addBdag, 18) ?? 0n, [addBdag]);

  const requiredUsdcRaw = useMemo(() => {
    if (!isAutoQuote) return 0n;
    return calcRequiredUsdc(addBdagRaw, resUsdcRaw, resWbdagRaw);
  }, [isAutoQuote, addBdagRaw, resUsdcRaw, resWbdagRaw]);

  const addUsdcRaw = useMemo(() => {
    if (isAutoQuote) return requiredUsdcRaw;
    const x = parseUnitsSafe(addUsdc, wusdcDecimals);
    return x ?? 0n;
  }, [addUsdc, isAutoQuote, requiredUsdcRaw, wusdcDecimals]);

  const addUsdcText = useMemo(() => {
    const raw = isAutoQuote ? requiredUsdcRaw : addUsdcRaw;
    return formatUnitsTrim(raw, wusdcDecimals, 6);
  }, [isAutoQuote, requiredUsdcRaw, addUsdcRaw, wusdcDecimals]);

  const priceUsdcPerBdagText = useMemo(() => {
    const p = calcPriceUsdcPerBdagRaw(resUsdcRaw, resWbdagRaw);
    return formatUnitsTrim(p, wusdcDecimals, 6);
  }, [resUsdcRaw, resWbdagRaw, wusdcDecimals]);

  const lpTotalText = useMemo(() => formatUnitsTrim(lpTotalSupplyRaw, 18, 18), [lpTotalSupplyRaw]);
  const userLpText = useMemo(() => formatUnitsTrim(userLpRaw, 18, 18), [userLpRaw]);

  const isMainOpen = expandedPoolId === MAIN_POOL_ID;

  const createBdagRaw = useMemo(() => parseUnitsSafe(createBdag, 18) ?? 0n, [createBdag]);

  const createRequiredUsdcRaw = useMemo(() => {
    if (!isAutoQuote) return 0n;
    return calcRequiredUsdc(createBdagRaw, resUsdcRaw, resWbdagRaw);
  }, [isAutoQuote, createBdagRaw, resUsdcRaw, resWbdagRaw]);

  const createUsdcRaw = useMemo(() => {
    if (isAutoQuote) return createRequiredUsdcRaw;
    const x = parseUnitsSafe(createUsdc, wusdcDecimals);
    return x ?? 0n;
  }, [createUsdc, isAutoQuote, createRequiredUsdcRaw, wusdcDecimals]);

  const createUsdcText = useMemo(() => {
    const raw = isAutoQuote ? createRequiredUsdcRaw : createUsdcRaw;
    return formatUnitsTrim(raw, wusdcDecimals, 6);
  }, [isAutoQuote, createRequiredUsdcRaw, createUsdcRaw, wusdcDecimals]);

  const poolAddBdagRaw = useMemo(() => parseUnitsSafe(poolAddBdag, 18) ?? 0n, [poolAddBdag]);

  const poolRequiredUsdcRaw = useMemo(() => {
    if (!isAutoQuote) return 0n;
    return calcRequiredUsdc(poolAddBdagRaw, resUsdcRaw, resWbdagRaw);
  }, [isAutoQuote, poolAddBdagRaw, resUsdcRaw, resWbdagRaw]);

  const poolAddUsdcRaw = useMemo(() => {
    if (isAutoQuote) return poolRequiredUsdcRaw;
    const x = parseUnitsSafe(poolAddUsdc, wusdcDecimals);
    return x ?? 0n;
  }, [poolAddUsdc, isAutoQuote, poolRequiredUsdcRaw, wusdcDecimals]);

  const poolAddUsdcText = useMemo(() => {
    const raw = isAutoQuote ? poolRequiredUsdcRaw : poolAddUsdcRaw;
    return formatUnitsTrim(raw, wusdcDecimals, 6);
  }, [isAutoQuote, poolRequiredUsdcRaw, poolAddUsdcRaw, wusdcDecimals]);

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
      setPoolsStatus("Ready");
    } catch (e) {
      setPoolsStatus("Ready");
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
    if (!isAutoQuote) {
      setCreatePoolError("Pool ratio not available yet (seed the main pool first)");
      return;
    }

    setCreatePoolError("");
    setCreatePoolTx("");
    setCreatePoolStatus("Idle");

    const addRes = await runAddLiquidity({
      bdagRaw: createBdagRaw,
      usdcRaw: createUsdcRaw,
      setStatus: setCreatePoolStatus,
      setError: setCreatePoolError,
      setTx: setCreatePoolTx,
      finalizeStatus: false,
    });

    const txHash = addRes?.txHash || "";
    const lpRaw = addRes?.lpMintedRaw ?? 0n;
    if (!txHash) return;
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
        body: JSON.stringify({ owner: account }),
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
          bdagRaw: createBdagRaw.toString(),
          usdcRaw: createUsdcRaw.toString(),
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

  async function runAddLiquidity({ bdagRaw, usdcRaw, setStatus, setError, setTx, finalizeStatus = true }) {
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
    if (!wrappedAddr) {
      setError("WBDAG not loaded");
      return null;
    }
    if (!wusdcAddr) {
      setError("WUSDC not configured");
      return null;
    }

    if (bdagRaw <= 0n) {
      setError("Enter BDAG amount");
      return null;
    }
    if (usdcRaw <= 0n) {
      setError("Enter USDC amount");
      return null;
    }

    try {
      setStatus("Preparing tx...");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const router = new ethers.Contract(dep.router, ROUTER_ABI, signer);
      const usdc = new ethers.Contract(wusdcAddr, ERC20_ABI, signer);

      setStatus("Checking allowance...");
      const allowance = await retryView(() => usdc.allowance(account, dep.router)).catch(() => 0n);
      if (allowance < usdcRaw) {
        setStatus("Approving USDC...");
        const txA = await usdc.approve(dep.router, usdcRaw, { gasLimit: GAS.APPROVE });
        setPendingTx(txA.hash);
        setTx(txA.hash);
        setStatus(`Approve pending: ${txA.hash}`);
        await txA.wait();
        setPendingTx("");
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * DEADLINE_MINUTES);

      setStatus("Adding liquidity...");
      const tx = await router.addLiquidityETH(
        {
          token: wusdcAddr,
          amountTokenDesired: usdcRaw,
          amountTokenMin: 0,
          amountETHMin: 0,
          to: account,
          deadline,
        },
        { value: bdagRaw, gasLimit: GAS.LIQ }
      );

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
        const p = await retryView(() => factory.getPair(wrappedAddr, wusdcAddr));
        if (p && !isZeroAddr(p)) pairAfter = p;
      } catch {}

      const lpMintedRaw = extractMintedLpFromReceipt({ receipt: rc, pairAddress: pairAfter, to: account });
      return { txHash: tx.hash, receipt: rc, pairAddr: pairAfter, lpMintedRaw };
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
      bdagRaw: addBdagRaw,
      usdcRaw: addUsdcRaw,
      setStatus: setAddStatus,
      setError: setAddError,
      setTx: setAddTx,
    });
  }

  async function onDepositToPool(poolId) {
    if (pendingTx) return;
    if (!walletOk) return;
    if (!account) {
      setPoolDepositError("Connect wallet");
      return;
    }
    if (!poolId) {
      setPoolDepositError("Open a pool");
      return;
    }
    if (!isAutoQuote) {
      setPoolDepositError("Pool ratio not available yet (seed the main pool first)");
      return;
    }

    setPoolDepositError("");
    setPoolDepositTx("");
    setPoolDepositStatus("Idle");

    const base = getApiBase();

    const addRes = await runAddLiquidity({
      bdagRaw: poolAddBdagRaw,
      usdcRaw: poolAddUsdcRaw,
      setStatus: setPoolDepositStatus,
      setError: setPoolDepositError,
      setTx: setPoolDepositTx,
      finalizeStatus: false,
    });

    const txHash = addRes?.txHash || "";
    const lpRaw = addRes?.lpMintedRaw ?? 0n;
    if (!txHash) return;
    if (lpRaw <= 0n) {
      setPoolDepositStatus("Failed");
      setPoolDepositError("LP minted not detected");
      return;
    }

    try {
      setPoolDepositStatus("Recording liquidity...");
      const res = await fetch(`${base}/api/pools/${encodeURIComponent(poolId)}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: account,
          bdagRaw: poolAddBdagRaw.toString(),
          usdcRaw: poolAddUsdcRaw.toString(),
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

      if (recordPoolId && (amount0 > 0n || amount1 > 0n)) {
        try {
          let bdagOut = 0n;
          let usdcOut = 0n;
          if (sameAddr(t0, wrappedAddr) && sameAddr(t1, wusdcAddr)) {
            bdagOut = amount0;
            usdcOut = amount1;
          } else if (sameAddr(t1, wrappedAddr) && sameAddr(t0, wusdcAddr)) {
            bdagOut = amount1;
            usdcOut = amount0;
          }

          if (bdagOut > 0n || usdcOut > 0n) {
            setRemoveStatus("Recording withdrawal...");
            const base = getApiBase();
            await fetch(`${base}/api/pools/${encodeURIComponent(recordPoolId)}/withdrawals`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                wallet: account,
                bdagRaw: bdagOut.toString(),
                usdcRaw: usdcOut.toString(),
                lpRaw: lpRaw.toString(),
                txHash: tx2.hash,
              }),
            });
            await refreshPools();
          }
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
                  <div className="sub">BDAG/WUSDC</div>
                </div>
              </div>

              <div className="swapBox">
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">Create pool</div>
                  <div className="swapTokenPill">BDAG/WUSDC</div>
                </div>
                <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                  Ratio is taken from the main pool: 1 BDAG ~ {priceUsdcPerBdagText} WUSDC.
                </div>
              </div>

              <div className="swapBox" style={{ marginTop: 12 }}>
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">BDAG amount</div>
                  <div className="swapTokenPill">BDAG</div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={createBdag}
                    onChange={(e) => setCreateBdag(sanitizeAmountInput(e.target.value, 18))}
                    placeholder="0.0"
                    inputMode="decimal"
                    disabled={!!pendingTx || !isSupportedChain}
                  />
                </div>
              </div>

              <div className="swapBox" style={{ marginTop: 12 }}>
                <div className="swapBoxHead">
                  <div className="swapBoxTitle">WUSDC amount</div>
                  <div className="swapTokenPill">WUSDC</div>
                </div>
                <div className="swapBoxRow">
                  <input
                    className="input swapAmountInput"
                    value={isAutoQuote ? createUsdcText : createUsdc}
                    onChange={(e) => setCreateUsdc(sanitizeAmountInput(e.target.value, wusdcDecimals))}
                    placeholder="0.0"
                    inputMode="decimal"
                    disabled={!!pendingTx || !isSupportedChain || isAutoQuote}
                    readOnly={isAutoQuote}
                  />
                </div>
                {isAutoQuote && (
                  <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                    Required WUSDC is auto-calculated from reserves.
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn swapCta"
                disabled={!!pendingTx || !isSupportedChain || !isAutoQuote || !dep?.router || !wusdcAddr}
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
                </div>
              )}
            </div>

            <div className="card swapCard" style={{ marginTop: 12 }}>
              <div className="cardHeader swapHeader">
                <div>
                  <div className="title">Pools</div>
                  <div className="sub">Main pool + user pools</div>
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
                    {formatUnitsTrim(resWbdagRaw, 18, 6)} BDAG + {formatUnitsTrim(resUsdcRaw, wusdcDecimals, 2)} WUSDC
                  </span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Price: <span className="kv">1 BDAG ~ {priceUsdcPerBdagText} WUSDC</span>
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
                        <div className="swapBoxTitle">BDAG amount</div>
                        <div className="swapTokenPill">BDAG</div>
                      </div>
                      <div className="swapBoxRow">
                        <input
                          className="input swapAmountInput"
                          value={addBdag}
                          onChange={(e) => setAddBdag(sanitizeAmountInput(e.target.value, 18))}
                          placeholder="0.0"
                          inputMode="decimal"
                          disabled={!!pendingTx || !isSupportedChain}
                        />
                      </div>
                    </div>

                    <div className="swapBox" style={{ marginTop: 12 }}>
                      <div className="swapBoxHead">
                        <div className="swapBoxTitle">WUSDC amount</div>
                        <div className="swapTokenPill">WUSDC</div>
                      </div>
                      <div className="swapBoxRow">
                        <input
                          className="input swapAmountInput"
                          value={isAutoQuote ? addUsdcText : addUsdc}
                          onChange={(e) => setAddUsdc(sanitizeAmountInput(e.target.value, wusdcDecimals))}
                          placeholder="0.0"
                          inputMode="decimal"
                          disabled={!!pendingTx || !isSupportedChain || isAutoQuote}
                          readOnly={isAutoQuote}
                        />
                      </div>
                      {isAutoQuote && (
                        <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                          Required WUSDC is auto-calculated from reserves.
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn swapCta"
                      disabled={!!pendingTx || !isSupportedChain || !dep?.router || !wusdcAddr}
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
                          disabled={!!pendingTx || !isSupportedChain}
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
                      disabled={!!pendingTx || !isSupportedChain || !poolExists || userLpRaw <= 0n}
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
                const totalBdagText = formatUnitsTrim(safeBigInt(p?.totalBdagRaw), 18, 6);
                const totalUsdcText = formatUnitsTrim(safeBigInt(p?.totalUsdcRaw), wusdcDecimals, 2);
                const poolUserLpRaw = safeBigInt(p?.userLpRaw);
                const removableLpRaw = poolUserLpRaw < userLpRaw ? poolUserLpRaw : userLpRaw;
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
                    <div className="small" style={{ marginTop: 6 }}>
                      Activity: <span className="kv">{p.depositCount || 0}</span> - Total:{" "}
                      <span className="kv">
                        {totalBdagText} BDAG + {totalUsdcText} WUSDC
                      </span>
                    </div>

                    {isOpen && (
                      <>
                        <div className="swapBox" style={{ marginTop: 12 }}>
                          <div className="swapBoxHead">
                            <div className="swapBoxTitle">BDAG amount</div>
                            <div className="swapTokenPill">BDAG</div>
                          </div>
                          <div className="swapBoxRow">
                            <input
                              className="input swapAmountInput"
                              value={poolAddBdag}
                              onChange={(e) => setPoolAddBdag(sanitizeAmountInput(e.target.value, 18))}
                              placeholder="0.0"
                              inputMode="decimal"
                              disabled={!!pendingTx || !isSupportedChain}
                            />
                          </div>
                        </div>

                        <div className="swapBox" style={{ marginTop: 12 }}>
                          <div className="swapBoxHead">
                            <div className="swapBoxTitle">WUSDC amount</div>
                            <div className="swapTokenPill">WUSDC</div>
                          </div>
                          <div className="swapBoxRow">
                            <input
                              className="input swapAmountInput"
                              value={isAutoQuote ? poolAddUsdcText : poolAddUsdc}
                              onChange={(e) => setPoolAddUsdc(sanitizeAmountInput(e.target.value, wusdcDecimals))}
                              placeholder="0.0"
                              inputMode="decimal"
                              disabled={!!pendingTx || !isSupportedChain || isAutoQuote}
                              readOnly={isAutoQuote}
                            />
                          </div>
                          {isAutoQuote && (
                            <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                              Ratio is taken from the main pool: 1 BDAG ~ {priceUsdcPerBdagText} WUSDC.
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn swapCta"
                          disabled={!!pendingTx || !isSupportedChain || !isAutoQuote || !dep?.router || !wusdcAddr}
                          onClick={() => onDepositToPool(p.id)}
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
                              disabled={!!pendingTx || !isSupportedChain}
                            />
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap" }}
                              onClick={() => setRemoveLp(removableLpText)}
                              disabled={!!pendingTx || removableLpRaw <= 0n}
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
                          disabled={!!pendingTx || !isSupportedChain || !poolExists || removableLpRaw <= 0n}
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
    </div>
  );
}
