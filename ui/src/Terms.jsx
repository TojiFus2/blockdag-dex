import React from "react";
import LegalPage from "./components/LegalPage";

const LAST_UPDATED = "2025-12-30";

export default function Terms() {
  return (
    <LegalPage title="Terms of Use" lastUpdated={LAST_UPDATED}>
      <h1>Terms of Use</h1>

      <h2>1. Introduction</h2>
      <p>
        BlockDAG Exchange provides a non-custodial web interface (the "Interface") that functions as a technical software tool to help users
        interact with public smart contracts on supported blockchain networks through a user-controlled wallet. The Interface is provided "as
        is" and "as available".
      </p>

      <h2>2. Non-Custodial Nature</h2>
      <p>
        The Interface does not custody, hold, control, or possess your digital assets. You remain solely responsible for your wallet, private
        keys, seed phrase, approvals/allowances, and all actions taken using your wallet. We cannot access your wallet or reverse any
        transaction you authorize.
      </p>

      <h2>3. No Advice</h2>
      <p>
        Nothing on the Interface constitutes financial, investment, legal, tax, or other professional advice. We do not act as a broker,
        intermediary, agent, or fiduciary, and no fiduciary duty is created by your use of the Interface.
      </p>

      <h2>4. On-Chain Transactions</h2>
      <p>
        Transactions initiated through the Interface are executed on-chain by smart contracts and processed by the underlying blockchain
        network. On-chain transactions are generally irreversible once confirmed. You are solely responsible for verifying transaction
        parameters before approving them in your wallet, including token addresses, amounts, recipient addresses, slippage settings, and any
        required approvals/allowances.
      </p>

      <h2>5. Fees</h2>
      <p>
        The Interface may apply a fee (for example, an interface fee or protocol fee) to certain swaps. If a fee applies, it is intended to be
        displayed before you confirm the transaction in your wallet. Fees are executed on-chain and are non-refundable once the transaction is
        confirmed. Fees may change at any time.
      </p>

      <h2>6. Third-Party Dependencies</h2>
      <p>
        Your use of the Interface depends on third parties and external systems, including wallet providers, blockchain networks, RPC
        endpoints, token contracts, and other smart contracts. Those third parties operate independently and may change, fail, be exploited,
        or become unavailable. To the maximum extent permitted by law, we are not responsible for Third-Party Services or external
        infrastructure.
      </p>

      <h2>7. Risks</h2>
      <p>
        Using digital assets and smart contracts involves significant risks, including the risk of total loss. Risks include, without
        limitation: software bugs, smart contract vulnerabilities, network congestion, transaction failures, user error, malicious tokens,
        token logic (for example, transfer fees, rebasing, pausing, blacklists), price volatility, liquidity and price impact, and third-party
        wallet or RPC failures. By using the Interface, you acknowledge and accept these risks.
      </p>

      <h2>8. Availability</h2>
      <p>
        The Interface may be modified, suspended, or discontinued at any time. We do not guarantee uptime, availability, or that the
        Interface will be uninterrupted or error-free. Blockchain networks may experience halts, reorgs, congestion, or unexpected behavior.
      </p>

      <h2>9. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. We will update the "Last updated" date above. Your continued use of the Interface after
        changes become effective constitutes acceptance of the updated Terms.
      </p>

    
    </LegalPage>
  );
}

