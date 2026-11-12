"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "unconfigured" | "off" | "on" | "busy";

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const LABEL: Record<State, string> = {
  loading: "Notifications",
  unsupported: "Notifications unavailable",
  "ios-install": "Notifications",
  denied: "Notifications blocked",
  unconfigured: "Notifications unavailable",
  off: "Notifications off",
  on: "Notifications on",
  busy: "Working...",
};

const HINT: Partial<Record<State, string>> = {
  unsupported: "This browser does not support push notifications.",
  "ios-install": "On iPhone, add EGO to your Home Screen first, then open it from there to turn on notifications.",
  denied: "Notifications are blocked. Allow them for this site in your browser or system settings.",
  unconfigured: "Push is not set up on the server yet.",
};

/** Small header toggle: subscribes this device to web push for EGO's proactive messages. */
export default function PushToggle() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      let next: State;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = isIos() && !isStandalone() ? "ios-install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          next = sub && Notification.permission === "granted" ? "on" : "off";
        } catch {
          next = "off";
        }
      }
      if (!cancelled) setState(next);
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function post(body: Record<string, unknown>): Promise<Response> {
    return fetch("/api/ego/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function enable() {
    setState("busy");
    try {
      const keyRes = await fetch("/api/ego/push", { cache: "no-store" });
      if (keyRes.status === 503) return setState("unconfigured");
      if (!keyRes.ok) return setState("off");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey),
        }));
      const res = await post({ action: "subscribe", subscription: sub.toJSON() });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        return setState(res.status === 503 ? "unconfigured" : "off");
      }
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  const interactive = state === "off" || state === "on";
  const hint = HINT[state];
  return (
    <div className="ego-push">
      <button
        type="button"
        className="ego-push-btn"
        aria-pressed={state === "on"}
        disabled={!interactive}
        onClick={state === "on" ? disable : enable}
      >
        {LABEL[state]}
      </button>
      {hint ? <p className="ego-push-hint">{hint}</p> : null}
    </div>
  );
}
