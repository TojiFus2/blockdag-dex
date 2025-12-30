import React, { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import logo from "./assets/logo.png";

import { loadDeployments } from "./lib/deployments";
import { ensureSupportedNetwork, getBrowserProvider, requestAccounts, hasInjected } from "./lib/eth";
import { BackgroundFX } from "./components/BackgroundFX";
import ErrorBoundary from "./components/ErrorBoundary";
import LandingPage from "./pages/LandingPage";
import SwapPage from "./pages/SwapPage";
import PoolPage from "./pages/PoolPage";

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

export default function App() {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isDex = location.pathname === "/swap" || location.pathname === "/pool";

  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [dep, setDep] = useState(null);

  const [pendingTx, setPendingTx] = useState("");

  const walletOk = hasInjected();

  function disconnect() {
    setError("");
    setStatus("Idle");
    setAccount("");
    setChainId(null);
    setDep(null);
    setPendingTx("");
  }

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

  useEffect(() => {
    document.body.classList.toggle("route-landing", isLanding);
    document.documentElement.classList.toggle("route-landing", isLanding);
    document.body.classList.toggle("route-dex", isDex);
    document.documentElement.classList.toggle("route-dex", isDex);
    return () => {
      document.body.classList.remove("route-landing");
      document.documentElement.classList.remove("route-landing");
      document.body.classList.remove("route-dex");
      document.documentElement.classList.remove("route-dex");
    };
  }, [isLanding, isDex]);

  return (
    <>
      {!isLanding && <BackgroundFX />}

      {!isLanding && (
        <div className="nav">
          <div className="navInner">
            <Link className="brand" to="/">
              <img src={logo} alt="logo" />
              <div className="brandTitle">
                <b>BlockDAG Exchange (Testnet)</b>
              </div>
            </Link>

            <div className="navLinks">
              <Link to="/swap">SWAP</Link>
              <Link to="/pool">POOL</Link>
            </div>

            <div className="navRight">
              <div className="pill">{account ? `Wallet: ${shortAddr(account)}` : "Wallet: not connected"}</div>
              <button
                className="btn btnConnect"
                onClick={() => {
                  if (account) disconnect();
                  else connect();
                }}
                disabled={!walletOk || !!pendingTx}
              >
                {account ? "Logout" : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLanding && !!error && (
        <div className="container">
          <div className="small bad" style={{ marginTop: 10 }}>
            {error}
          </div>
        </div>
      )}

      <Routes>
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <LandingPage />
            </ErrorBoundary>
          }
        />
        <Route path="/app" element={<Navigate to="/swap" replace />} />
        <Route
          path="/swap"
          element={
            <ErrorBoundary>
              <SwapPage account={account} chainId={chainId} dep={dep} pendingTx={pendingTx} setPendingTx={setPendingTx} />
            </ErrorBoundary>
          }
        />
        <Route
          path="/pool"
          element={
            <ErrorBoundary>
              <PoolPage />
            </ErrorBoundary>
          }
        />
        <Route path="/faucet" element={<Navigate to="/swap" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isLanding && (
        <footer className="footer">
          <div className="footerLine" />
          <div className="footerInner">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/cookies">Cookies</Link>
            </div>
            <div>{"\u00A9 2025 AC."}</div>
          </div>
        </footer>
      )}
    </>
  );
}
