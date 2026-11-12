"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "ego-install-dismissed";

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return ios && safari;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** iOS has no install prompt event: show Add to Home Screen instructions on iOS Safari when not installed. */
export default function InstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Client-only environment checks must run after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isIosSafari() && !isStandalone() && !wasDismissed()) setShow(true);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable: dismissal lasts for this visit only */
    }
    setShow(false);
  };

  return (
    <aside className="ego-install" role="note" aria-label="Install EGO">
      <p>Install EGO: tap Share, then Add to Home Screen.</p>
      <button type="button" onClick={dismiss} aria-label="Dismiss install tip">
        Dismiss
      </button>
    </aside>
  );
}
