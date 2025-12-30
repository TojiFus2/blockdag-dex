import React from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";

export default function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="landingHero" aria-label="Hero">
      <div className="landingHeroInner">
        <img className="landingHeroLogo" src={logo} alt="BlockDAG Exchange logo" />

        <h1 className="landingH1">Swap. Own. Done.</h1>
        <p className="landingSub">A lightweight, non-custodial DEX built on BlockDAG.</p>

        <div className="landingHeroCtas">
          <button
            type="button"
            className="landingBtn landingBtnPrimary"
            onClick={() => navigate("/swap")}
          >
            Launch App
          </button>
          <a
            className="landingBtn landingBtnSecondary"
            href="https://docs.blockdagnetwork.io/introduction-to-blockdag"
            target="_blank"
            rel="noreferrer"
          >
            View Docs
          </a>
        </div>
      </div>
    </section>
  );
}
