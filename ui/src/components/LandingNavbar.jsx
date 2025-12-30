import React from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";

export default function LandingNavbar() {
  const navigate = useNavigate();

  function scrollToHow(e) {
    e.preventDefault();
    const el = document.getElementById("how-it-works");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <header className="landingNavWrap">
      <div className="landingNav">
        <div className="landingNavInner">
          <a className="landingBrand" href="#top" aria-label="BlockDAG Exchange">
            <img className="landingNavLogo" src={logo} alt="BlockDAG Exchange logo" />
            <span className="landingBrandName">BlockDAG Exchange</span>
          </a>

          <nav className="landingNavLinks" aria-label="Links">
            <a href="#how-it-works" onClick={scrollToHow}>
              How it works
            </a>
            <a href="https://docs.blockdagnetwork.io/introduction-to-blockdag" target="_blank" rel="noreferrer">
              Docs
            </a>
            <button
              type="button"
              className="landingBtn landingBtnPrimary"
              onClick={() => navigate("/swap")}
            >
              Launch App
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}
