"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ego/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        router.replace("/ego");
        return;
      }
      setError(res.status === 401 ? "That token was not accepted." : "Could not sign in. Please try again.");
    } catch {
      setError("Could not reach the server.");
    }
    setPending(false);
  }

  return (
    <form className="ego-login" onSubmit={submit}>
      <div className="ego-name">EGO</div>
      <label htmlFor="ego-token">Access token</label>
      <input
        id="ego-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="current-password"
        autoFocus
        required
      />
      {error && (
        <p className="ego-error" role="alert">
          {error}
        </p>
      )}
      <button className="ego-primary" type="submit" disabled={pending || !token}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
