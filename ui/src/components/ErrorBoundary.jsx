import React from "react";
import { Link } from "react-router-dom";

function toErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the app usable while surfacing the crash details for debugging.
    // eslint-disable-next-line no-console
    console.error("UI crashed:", error, info);
  }

  render() {
    const err = this.state?.error;
    if (!err) return this.props.children;

    return (
      <div className="container">
        <div className="swapShell">
          <div className="card swapCard">
            <div className="cardHeader swapHeader">
              <div>
                <div className="title">Page error</div>
                <div className="sub">The UI crashed (see console)</div>
              </div>
            </div>

            <div className="swapStatus bad" style={{ wordBreak: "break-word" }}>
              {toErr(err)}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn swapCta" onClick={() => window.location.reload()}>
                Reload
              </button>
              <Link to="/" className="btn swapCta" style={{ textAlign: "center" }}>
                Go to Swap
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

