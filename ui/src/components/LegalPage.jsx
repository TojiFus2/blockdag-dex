import React from "react";
import { Link } from "react-router-dom";
import logo from "../assets/logo.png";
import { BackgroundFX } from "./BackgroundFX";

function LegalLinks() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Link to="/terms">Terms</Link>
      <Link to="/privacy">Privacy</Link>
      <Link to="/cookies">Cookies</Link>
    </div>
  );
}

export default function LegalPage({ title, lastUpdated, children }) {
  return (
    <>
      <BackgroundFX />

      <div className="nav">
        <div className="navInner">
          <Link className="brand" to="/">
            <img src={logo} alt="logo" />
            <div className="brandTitle">
              <b>BlockDAG Exchange</b>
              <span>DEX interface</span>
            </div>
          </Link>

          <div className="navRight" style={{ gap: 10 }}>
            <Link className="btn btnConnect termsBackBtn" to="/swap">
              Back to App
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="termsShell">
          <div className="card termsCard">
            <div className="termsHeader">
              <div>
                <div className="title">{title}</div>
                <div className="sub">Last updated: {lastUpdated}</div>
              </div>
              <div className="small" style={{ textAlign: "right" }}>
                <LegalLinks />
              </div>
            </div>

            <div className="termsProse">{children}</div>
          </div>
        </div>
      </div>

      <footer className="footer">
        <div className="footerLine" />
        <div className="footerInner" style={{ gap: 14 }}>
          <LegalLinks />
          <div>{"\u00A9 2025 AC."}</div>
        </div>
      </footer>
    </>
  );
}
