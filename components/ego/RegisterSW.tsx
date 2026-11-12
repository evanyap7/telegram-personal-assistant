"use client";

import { useEffect } from "react";

/** Registers the service worker (served from /sw.js with Service-Worker-Allowed: /ego) for scope /ego. */
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/ego", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
