import { cookies } from "next/headers";
import { SESSION_COOKIE, authConfigured, verifySession } from "./auth";

/** Server-component check of the httpOnly session cookie (the client cannot read it). */
export async function hasValidSession(): Promise<boolean> {
  if (!authConfigured()) return false;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, process.env.EGO_APP_SECRET ?? "", Date.now());
}
