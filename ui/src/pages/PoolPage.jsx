import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import { loadDeployments } from "../lib/deployments";
import { getBrowserProvider, hasInjected, requestAccounts } from "../lib/eth";
import { TOKENS_1043 } from "../lib/tokens_1043";

const CHAIN_ID = 1043;

const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address)"];

const PAIR_ABI = [
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

  const lpTotalText = useMemo(() => formatUnitsTrim(lpTotalSupplyRaw, 18, 6), [lpTotalSupplyRaw]);
  const userLpText = useMemo(() => formatUnitsTrim(userLpRaw, 18, 6), [userLpRaw]);

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

  async function onAddLiquidity() {
    if (pendingTx) return;
    if (!walletOk) return;
    if (!account) return setAddError("Connect wallet");
    if (!isSupportedChain) return setAddError(`Wrong network (chainId ${chainId ?? "?"})`);
    if (!dep?.router) return setAddError("Router not loaded");
    if (!factoryAddr) return setAddError("Factory not loaded");
    if (!wrappedAddr) return setAddError("WBDAG not loaded");
    if (!wusdcAddr) return setAddError("WUSDC not configured");

    setAddError("");
    setAddTx("");
    setAddStatus("Idle");

    if (addBdagRaw <= 0n) return setAddError("Enter BDAG amount");
    if (addUsdcRaw <= 0n) return setAddError("Enter USDC amount");

    try {
      setAddStatus("Preparing tx...");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const router = new ethers.Contract(dep.router, ROUTER_ABI, signer);
      const usdc = new ethers.Contract(wusdcAddr, ERC20_ABI, signer);

      setAddStatus("Checking allowance...");
      const allowance = await retryView(() => usdc.allowance(account, dep.router)).catch(() => 0n);
      if (allowance < addUsdcRaw) {
        setAddStatus("Approving USDC...");
        const txA = await usdc.approve(dep.router, addUsdcRaw, { gasLimit: GAS.APPROVE });
        setPendingTx(txA.hash);
        setAddTx(txA.hash);
        setAddStatus(`Approve pending: ${txA.hash}`);
        await txA.wait();
        setPendingTx("");
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * DEADLINE_MINUTES);

      setAddStatus("Adding liquidity...");
      const tx = await router.addLiquidityETH(
        {
          token: wusdcAddr,
          amountTokenDesired: addUsdcRaw,
          amountTokenMin: 0,
          amountETHMin: 0,
          to: account,
          deadline,
        },
        { value: addBdagRaw, gasLimit: GAS.LIQ }
      );

      setPendingTx(tx.hash);
      setAddTx(tx.hash);
      setAddStatus(`Pending: ${tx.hash}`);

      const rc = await tx.wait();
      setPendingTx("");
      if (rc?.status !== 1) throw new Error("Transaction failed");

      setAddStatus("Success");
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      setPendingTx("");
      setAddStatus("Failed");
      setAddError(toErr(e));
      setRefreshNonce((n) => n + 1);
    }
  }

  async function onRemoveLiquidity() {
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
    if (lpRaw > userLpRaw) return setRemoveError("LP amount exceeds your balance");

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

      setRemoveStatus("Burning LP...");
      const tx2 = await pair.burn(account, { gasLimit: GAS.REMOVE });
      setPendingTx(tx2.hash);
      setRemoveTx(tx2.hash);
      setRemoveStatus(`Pending: ${tx2.hash}`);
      const rc2 = await tx2.wait();
      setPendingTx("");
      if (rc2?.status !== 1) throw new Error("Burn failed");

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
                  <div className="title">BDAG/USDC Pool</div>
                  <div className="sub">WBDAG / WUSDC</div>
                </div>
              </div>

              {!!pageError && <div className="swapStatus bad">{pageError}</div>}
              {pageStatus !== "Ready" && <div className="swapStatus ok">{pageStatus}</div>}
              {!isSupportedChain && chainId != null && (
                <div className="swapStatus bad">Wrong network (chainId {chainId}).</div>
              )}

              <div className="swapBox">
                <div className="small">
                  Pair:{" "}
                  <span className="kv">
                    {poolExists ? pairAddr : "Not created yet"}
                  </span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Reserves:{" "}
                  <span className="kv">
                    {formatUnitsTrim(resWbdagRaw, 18, 6)} BDAG + {formatUnitsTrim(resUsdcRaw, wusdcDecimals, 2)} USDC
                  </span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Price: <span className="kv">1 BDAG ~ {priceUsdcPerBdagText} USDC</span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  LP totalSupply: <span className="kv">{lpTotalText}</span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Your LP balance: <span className="kv">{userLpText}</span>
                </div>
              </div>
            </div>

            <div className="card swapCard" style={{ marginTop: 12 }}>
              <div className="cardHeader swapHeader">
                <div>
                  <div className="title">Create / Add Liquidity</div>
                  <div className="sub">BDAG amount (native)</div>
                </div>
              </div>

              <div className="swapBox">
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
                  <div className="swapBoxTitle">USDC amount</div>
                  <div className="swapTokenPill">USDC</div>
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
                    Required USDC is auto-calculated from reserves.
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
            </div>

            <div className="card swapCard" style={{ marginTop: 12 }}>
              <div className="cardHeader swapHeader">
                <div>
                  <div className="title">Remove Liquidity</div>
                  <div className="sub">Only your LP</div>
                </div>
              </div>

              <div className="swapBox">
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
                onClick={onRemoveLiquidity}
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

