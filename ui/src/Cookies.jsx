import React from "react";
import LegalPage from "./components/LegalPage";

const LAST_UPDATED = "2025-12-30";

export default function Cookies() {
  return (
    <LegalPage title="Cookie Policy" lastUpdated={LAST_UPDATED}>
      <h1>Cookie Policy</h1>

      <h2>1. Overview</h2>
      <p>
        Cookies are small text files placed on your device by a website. They are commonly used to enable core site functionality and, in
        some cases, analytics or advertising.
      </p>

      <h2>2. Cookies Used</h2>
      <p>
        The Interface does not use cookies for tracking, advertising, or profiling. If any cookies are present, they are expected to be
        strictly necessary technical cookies used to deliver the website (for example, basic security or routing features provided by
        hosting/CDN infrastructure).
      </p>

      <h2>3. Analytics</h2>
      <p>
        The Interface does not use analytics cookies. If analytics are introduced in the future, this policy will be updated before such
        changes take effect.
      </p>

      <h2>4. Control</h2>
      <p>
        You can manage or delete cookies through your browser settings. Note that disabling strictly necessary cookies (if any) may affect
        the availability or functionality of the website.
      </p>
    </LegalPage>
  );
}

