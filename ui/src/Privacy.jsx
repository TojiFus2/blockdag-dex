import React from "react";
import LegalPage from "./components/LegalPage";

const LAST_UPDATED = "2025-12-30";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <h1>Privacy Policy</h1>

      <h2>1. Overview</h2>
      <p>
        BlockDAG Exchange is a non-custodial, stateless web interface (the "Interface") used to interact with smart contracts on supported
        blockchain networks through a user-controlled wallet. By design, the Interface does not require user accounts and does not maintain a
        user database.
      </p>

      <h2>2. Data We Do NOT Collect</h2>
      <p>By design, we do not collect or store personal data through the Interface, including:</p>
      <ul>
        <li>IP addresses</li>
        <li>Wallet addresses</li>
        <li>Transaction histories or transaction metadata</li>
        <li>User profiles or account data</li>
      </ul>

      <h2>3. On-Chain Data</h2>
      <p>
        When you use your wallet to submit a transaction, that transaction is processed by the blockchain network. Blockchain transactions
        are public and may be accessible to anyone via blockchain explorers and other tools. The Interface does not control, modify, or
        delete on-chain data, and on-chain data is generally immutable.
      </p>

      <h2>4. Third-Party Services</h2>
      <p>
        The Interface depends on third-party components and services that operate independently from us, including wallet providers,
        blockchain networks, RPC providers, and blockchain explorers. Those third parties may collect or process data under their own privacy
        policies and terms. We encourage you to review those policies before using third-party services.
      </p>

      <h2>5. Security</h2>
      <p>
        We do not maintain a user database and do not request or store private keys or seed phrases. You are responsible for the security of
        your device and wallet. Never share your seed phrase or private keys.
      </p>

      <h2>6. User Rights</h2>
      <p>
        Because the Interface does not collect or store personal data by design, there is generally no personal data we can provide access
        to, correct, or delete. Any on-chain data is public and immutable and cannot be altered or erased by the Interface.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. We will update the "Last updated" date above. Continued use of the Interface
        after changes become effective constitutes acceptance of the updated Policy.
      </p>

    </LegalPage>
  );
}

