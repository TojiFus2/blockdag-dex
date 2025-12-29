import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

function shortAddr(a) {
  if (!a) return "";
  const s = String(a);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

export default function TokenSelectModal({
  open,
  tokens,
  balancesByAddress,
  searchQuery,
  onSearchQueryChange,
  onSelectToken,
  onImportAddress,
  onClose,
}) {
  const searchRef = useRef(null);
  const [importStatus, setImportStatus] = useState({ state: "idle", error: "" }); // idle|loading|error

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus?.(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setImportStatus({ state: "idle", error: "" });
  }, [open, searchQuery]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) return tokens || [];
    return (tokens || []).filter((t) => {
      const sym = (t.symbol || "").toLowerCase();
      const addr = (t.address || "").toLowerCase();
      return sym.includes(q) || addr.includes(q);
    });
  }, [tokens, searchQuery]);

  const importCandidate = useMemo(() => {
    const raw = String(searchQuery || "").trim();
    if (!raw) return null;
    if (!ethers.isAddress(raw)) return null;
    const lower = raw.toLowerCase();
    const exists = (tokens || []).some((t) => String(t?.address || "").toLowerCase() === lower);
    if (exists) return null;
    return raw;
  }, [searchQuery, tokens]);

  if (!open) return null;

  function formatBal(s) {
    if (!s) return "";
    const str = String(s);
    if (!str.includes(".")) return str;
    const [a, b] = str.split(".");
    const trimmed = b.replace(/0+$/, "");
    if (!trimmed) return a;
    return `${a}.${trimmed.slice(0, 6)}`;
  }

  return (
    <div
      className="tokenModalOverlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="card tokenModalCard" role="dialog" aria-modal="true" aria-label="Select a token">
        <div className="tokenModalHeader">
          <div className="title">Select a token</div>
          <button type="button" className="tokenModalClose" onClick={() => onClose?.()} aria-label="Close">
            {"\u00D7"}
          </button>
        </div>

        <input
          ref={searchRef}
          className="input"
          placeholder="Search name or paste address"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange?.(e.target.value)}
        />

        <div className="tokenModalList" role="list">
          {!!importCandidate && typeof onImportAddress === "function" && (
            <>
              <button
                type="button"
                className="tokenRow"
                onClick={async () => {
                  if (importStatus.state === "loading") return;
                  setImportStatus({ state: "loading", error: "" });
                  try {
                    const t = await onImportAddress(importCandidate);
                    if (!t) throw new Error("Token not found");
                    setImportStatus({ state: "idle", error: "" });
                    onSelectToken?.(t);
                  } catch (e) {
                    setImportStatus({ state: "error", error: e?.message || String(e) });
                  }
                }}
                title={`Import ${importCandidate}`}
              >
                <span className="tokenRowIcon" aria-hidden="true" />
                <span className="tokenRowMain">
                  <span className="tokenRowSymbol">{importStatus.state === "loading" ? "Importing..." : "Import token"}</span>
                  <span className="tokenRowSub">{shortAddr(importCandidate)}</span>
                </span>
                <span className="tokenRowBal" />
                <span className="tokenRowAddr">{shortAddr(importCandidate)}</span>
              </button>
              {importStatus.state === "error" && (
                <div className="small bad" style={{ padding: "8px 2px 0", opacity: 0.95 }}>
                  {importStatus.error}
                </div>
              )}
            </>
          )}

          {filtered.length === 0 ? (
            <div className="small" style={{ opacity: 0.85, padding: "10px 2px" }}>
              No results
            </div>
          ) : (
            filtered.map((t) => {
              const bal = balancesByAddress?.[String(t.address).toLowerCase()] || "";
              const balText = formatBal(bal);
              return (
                <button
                  key={t.address}
                  type="button"
                  className="tokenRow"
                  onClick={() => onSelectToken?.(t)}
                  title={t.address}
                >
                  <span className="tokenRowIcon" aria-hidden="true" />
                  <span className="tokenRowMain">
                    <span className="tokenRowSymbol">{t.symbol}</span>
                    <span className="tokenRowSub">{t.name || shortAddr(t.address)}</span>
                  </span>
                  <span className="tokenRowBal">{balText}</span>
                  <span className="tokenRowAddr">{shortAddr(t.address)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
