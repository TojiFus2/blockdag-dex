import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

function clampAmount(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

export default function FaucetPage({ account, pendingTx }) {
  const [wallet, setWallet] = useState("");
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [watchStatus, setWatchStatus] = useState("");

  useEffect(() => {
    if (!account) return;
    if (wallet) return;
    setWallet(account);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const amountClamped = useMemo(() => clampAmount(amount), [amount]);
  const disabled = !!pendingTx || isRequesting;

  async function drip() {
    if (disabled) return;
    setError("");
    setTxHash("");
    setWatchStatus("");

    if (!ethers.isAddress(wallet || "")) {
      setError("Invalid wallet");
      return;
    }

    const url = import.meta.env.DEV ? "http://localhost:8787/api/faucet/drip" : "/api/faucet/drip";

    try {
      setIsRequesting(true);
      setStatus("Requesting faucet...");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, amount: amountClamped }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      setTxHash(json.txHash || "");
      setStatus("WUSDC sent");
    } catch (e) {
      setError(toErr(e));
      setStatus("Idle");
    } finally {
      setIsRequesting(false);
    }
  }

  async function addWusdcToWallet() {
    setWatchStatus("");
    const eth = window?.ethereum;
    if (!eth?.request) {
      setWatchStatus("No wallet detected");
      return;
    }

    try {
      const ok = await eth.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2",
            symbol: "WUSDC",
            decimals: 6,
          },
        },
      });

      if (ok === true) setWatchStatus("Token added");
      else setWatchStatus("User rejected");
    } catch (e) {
      if (e?.code === 4001) setWatchStatus("User rejected");
      else setWatchStatus("Failed to add token");
    }
  }

  return (
    <div className="container">
      <div className="swapShell">
        <div className="card swapCard">
          <div className="cardHeader swapHeader">
            <div>
              <div className="title">Faucet</div>
              <div className="sub">WUSDC (max 100 / 24h)</div>
            </div>
          </div>

          <div className="swapBox">
            <div className="swapBoxHead">
              <div className="swapBoxTitle">Wallet</div>
              <div className="swapTokenPill">{wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "\u2014"}</div>
            </div>
            <div className="swapBoxRow">
              <input
                className="input swapAmountInput"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="0x..."
                disabled={disabled}
              />
            </div>
          </div>

          <div className="swapBox" style={{ marginTop: 12 }}>
            <div className="swapBoxHead">
              <div className="swapBoxTitle">Amount</div>
              <div className="swapTokenPill">WUSDC</div>
            </div>
            <div className="swapBoxRow">
              <input
                className="input swapAmountInput"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
                disabled={disabled}
              />
            </div>
            <div className="swapMeta small">Clamped to {amountClamped} (min 1, max 100)</div>
          </div>

          <button className="btn swapCta" disabled={disabled} onClick={drip}>
            {pendingTx ? "Pending transaction..." : isRequesting ? status : "Get WUSDC (100/day)"}
          </button>

          <div className={`swapStatus ${error ? "bad" : "ok"}`}>{error ? error : txHash ? `Tx: ${txHash}` : status}</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn swapCta" type="button" disabled={!!pendingTx} onClick={addWusdcToWallet}>
            Add WUSDC to wallet
          </button>
          {!!watchStatus && <div className={`swapStatus ${watchStatus === "Token added" ? "ok" : "bad"}`}>{watchStatus}</div>}
        </div>
      </div>
    </div>
  );
}
