import React from "react";
import { Link } from "react-router-dom";
import logo from "./assets/logo.png";
import { BackgroundFX } from "./components/BackgroundFX";

export default function Terms() {
  return (
    <>
      <BackgroundFX />

      <div className="nav">
        <div className="navInner">
          <div className="brand">
            <img src={logo} alt="logo" />
            <div className="brandTitle">
              <b>BlockDAG</b>
              <span>Local DEX (31337)</span>
            </div>
          </div>

          <div className="navRight">
            <Link className="btn btnConnect termsBackBtn" to="/">
              Back to Swap
            </Link>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="termsShell">
          <div className="card termsCard">
            <div className="termsHeader">
              <div className="title">Terms</div>
              <div className="sub">Last updated: 2025-12-20</div>
            </div>

            <div className="termsProse">
              <h1>BlockDAG Local DEX — Terms of Use</h1>
              <p>
                These Terms of Use (“Terms”) govern your access to and use of the BlockDAG Local DEX user interface (the
                “Interface”). By accessing or using the Interface, you agree to be bound by these Terms.
              </p>

              <h2>1. Experimental software</h2>
              <p>
                The Interface is provided for development and testing purposes. The Interface and any related smart
                contracts may be experimental, may contain bugs, and may change at any time without notice.
              </p>

              <h2>2. Testnet / local network</h2>
              <p>
                This Interface is intended to be used on a local Hardhat network (chain id 31337) or other non-production
                environments. Do not use real funds. You are responsible for verifying the network and addresses before
                signing any transaction.
              </p>

              <h2>3. No financial advice</h2>
              <p>
                Nothing on the Interface constitutes financial, investment, legal, or tax advice. You are solely
                responsible for your actions and any decisions you make.
              </p>

              <h2>4. Wallets and transactions</h2>
              <p>
                The Interface may interact with third-party wallet software (e.g., browser-injected wallets). You are
                responsible for keeping your wallet secure and for reviewing transaction details before approval. The
                Interface does not custody your assets and cannot reverse transactions.
              </p>

              <h2>5. No warranties</h2>
              <p>
                To the maximum extent permitted by law, the Interface is provided “as is” and “as available” without
                warranties of any kind, whether express or implied, including implied warranties of merchantability,
                fitness for a particular purpose, and non-infringement.
              </p>

              <h2>6. Limitation of liability</h2>
              <p>
                To the maximum extent permitted by law, in no event will the authors, maintainers, or contributors be
                liable for any indirect, incidental, consequential, special, or exemplary damages arising out of or in
                connection with your use of the Interface, even if advised of the possibility of such damages.
              </p>

              <h2>7. Acceptable use</h2>
              <p>You agree not to:</p>
              <ul>
                <li>Use the Interface for any unlawful purpose.</li>
                <li>Attempt to interfere with, disrupt, or compromise the Interface or related infrastructure.</li>
                <li>Bypass or attempt to bypass any security or access controls.</li>
              </ul>

              <h2>8. Changes to these Terms</h2>
              <p>
                We may update these Terms from time to time. If we make changes, we will update the “Last updated” date
                above. Your continued use of the Interface after changes become effective constitutes acceptance of the
                updated Terms.
              </p>

              <h2>9. Contact</h2>
              <p>
                If you have questions about these Terms, contact the project maintainer or your administrator for this
                environment.
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className="footer">
        <div className="footerLine" />
        <div className="footerInner">
          <Link to="/">Back to Swap</Link>
          <div>{"\u00A9 2025 AC."}</div>
        </div>
      </footer>
    </>
  );
}

