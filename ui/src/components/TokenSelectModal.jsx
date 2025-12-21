import React, { useEffect, useMemo, useRef } from "react";

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
  onClose,
}) {
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus?.(), 0);
    return () => clearTimeout(t);
  }, [open]);

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
