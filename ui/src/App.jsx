import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import logo from "./assets/logo.png";

import { loadDeployments } from "./lib/deployments";
import { ensureSupportedNetwork, getBrowserProvider, requestAccounts, hasInjected } from "./lib/eth";
import { BackgroundFX } from "./components/BackgroundFX";
import SwapPage from "./pages/SwapPage";
import PoolPage from "./pages/PoolPage";
import FaucetPage from "./pages/FaucetPage";

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [dep, setDep] = useState(null);

  const [pendingTx, setPendingTx] = useState("");

  const walletOk = hasInjected();

  async function connect() {
    setError("");
    setStatus("Connecting wallet...");
    try {
      await requestAccounts();

      const provider = await getBrowserProvider();
      const net = await provider.getNetwork();
      const cid = Number(net.chainId);

      await ensureSupportedNetwork([31337, 1043], cid);

      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAccount(addr);
      setChainId(cid);

      const d = await loadDeployments(cid);
      setDep(d);

      setStatus("Connected");
    } catch (e) {
      setError(toErr(e));
      setStatus("Idle");
    }
  }

  useEffect(() => {
    if (!walletOk) return;
    const handler = async () => {
      try {
        await connect();
      } catch {}
    };
    window.ethereum?.on?.("chainChanged", handler);
    window.ethereum?.on?.("accountsChanged", handler);
    return () => {
      window.ethereum?.removeListener?.("chainChanged", handler);
      window.ethereum?.removeListener?.("accountsChanged", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <BackgroundFX />

      <div className="nav">
        <div className="navInner">
          <div className="brand">
            <img src={logo} alt="logo" />
            <div className="brandTitle">
              <b>BlockDAG</b>
              <span>{chainId === 1043 ? "Testnet DEX" : "Local DEX"} ({chainId ?? "\u2014"})</span>
            </div>
          </div>

          <div className="navLinks">
            <Link to="/">SWAP</Link>
            <Link to="/pool">POOL</Link>
            <Link to="/faucet">FAUCET</Link>
          </div>

          <div className="navRight">
            <div className="pill">{account ? `Wallet: ${shortAddr(account)}` : "Wallet: not connected"}</div>
            <button className="btn btnConnect" onClick={connect} disabled={!walletOk || !!pendingTx}>
              Connect
            </button>
          </div>
        </div>
      </div>

      {!!error && (
        <div className="container">
          <div className="small bad" style={{ marginTop: 10 }}>
            {error}
          </div>
        </div>
      )}

      <Routes>
        <Route
          path="/"
          element={<SwapPage account={account} chainId={chainId} dep={dep} pendingTx={pendingTx} setPendingTx={setPendingTx} />}
        />
        <Route path="/pool" element={<PoolPage />} />
        <Route
          path="/faucet"
          element={<FaucetPage account={account} chainId={chainId} dep={dep} pendingTx={pendingTx} statusFromApp={status} />}
        />
      </Routes>

      <footer className="footer">
        <div className="footerLine" />
        <div className="footerInner">
          <Link to="/terms">Terms</Link>
          <div>{"\u00A9 2025 AC."}</div>
        </div>
      </footer>
    </>
  );
}
