import { google } from "googleapis";

function cleanPrivateKey(rawKey?: string): string | undefined {
  if (!rawKey) return undefined;
  let key = rawKey.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n").trim();
}

// Cached across invocations within the same warm serverless instance so we
// reuse the JWT/OAuth2 client's internally-cached access token instead of
// exchanging a fresh one with Google's OAuth server on every single call.
let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null;
let cachedGmailAuth:
  | InstanceType<typeof google.auth.JWT>
  | InstanceType<typeof google.auth.OAuth2>
  | null = null;
let cachedCalendarClient: ReturnType<typeof google.calendar> | null = null;
let cachedSheetsClient: ReturnType<typeof google.sheets> | null = null;
let cachedGmailClient: ReturnType<typeof google.gmail> | null = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service-account environment variables are missing."
    );
  }

  cachedAuth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  return cachedAuth;
}

function getGmailAuth() {
  if (cachedGmailAuth) return cachedGmailAuth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    cachedGmailAuth = oauth2Client;
    return cachedGmailAuth;
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const gmailUser = process.env.GOOGLE_GMAIL_USER;

  if (clientEmail && privateKey && gmailUser) {
    cachedGmailAuth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      subject: gmailUser,
      scopes: [
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
    });
    return cachedGmailAuth;
  }

  throw new Error(
    "Gmail credentials missing. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local (or run npm run get-gmail-token)."
  );
}

export function getCalendarClient() {
  if (!cachedCalendarClient) {
    cachedCalendarClient = google.calendar({
      version: "v3",
      auth: getAuth(),
    });
  }
  return cachedCalendarClient;
}

export function getSheetsClient() {
  if (!cachedSheetsClient) {
    cachedSheetsClient = google.sheets({
      version: "v4",
      auth: getAuth(),
    });
  }
  return cachedSheetsClient;
}

export function getGmailClient() {
  if (!cachedGmailClient) {
    cachedGmailClient = google.gmail({
      version: "v1",
      auth: getGmailAuth(),
    });
  }
  return cachedGmailClient;
}

/**
 * Generic retry with exponential backoff and jitter for transient API failures.
 */
export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 4000;

  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const status = error?.status || error?.code || error?.response?.status;
      const msg = String(error?.message || "");

      // Transient errors: 429 Quota/Rate limit, 500, 502, 503, 504, or network disconnects
      const isTransient =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        /rate limit|quota|resource_exhausted|backend error|econnreset|etimedout/i.test(msg);

      if (!isTransient || attempt === maxRetries) {
        throw error;
      }

      // Add random jitter
      const jitter = Math.random() * 200;
      const sleepTime = Math.min(delay + jitter, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      delay *= 2;
    }
  }

  throw new Error("Exponential backoff failed unexpectedly.");
}