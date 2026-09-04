import { google } from "googleapis";

function getAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google service-account environment variables are missing."
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

function getGmailAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const gmailUser = process.env.GOOGLE_GMAIL_USER;

  if (clientEmail && privateKey && gmailUser) {
    return new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      subject: gmailUser,
      scopes: ["https://www.googleapis.com/auth/gmail.compose"],
    });
  }

  throw new Error(
    "Gmail credentials missing. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local (or run npm run get-gmail-token)."
  );
}

export function getCalendarClient() {
  return google.calendar({
    version: "v3",
    auth: getAuth(),
  });
}

export function getSheetsClient() {
  return google.sheets({
    version: "v4",
    auth: getAuth(),
  });
}

export function getGmailClient() {
  return google.gmail({
    version: "v1",
    auth: getGmailAuth(),
  });
}