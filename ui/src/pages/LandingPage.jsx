import React from "react";
import { Link } from "react-router-dom";
import LandingHero from "../components/LandingHero";
import LandingNavbar from "../components/LandingNavbar";
import "../landing.css";

export default function LandingPage() {
  return (
    <div className="landingRoot" id="top">
      <LandingNavbar />
      <main className="landingMain">
        <LandingHero />
      </main>

      <footer className="footer" id="how-it-works">
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
    </div>
  );
}
