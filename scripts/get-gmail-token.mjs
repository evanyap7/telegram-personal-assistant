import http from "node:http";
import url from "node:url";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("❌ GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local.");
  console.log("\nSetup instructions:");
  console.log("1. Go to Google Cloud Console -> APIs & Services -> Credentials");
  console.log("2. Create OAuth 2.0 Client ID (Web Application or Desktop)");
  console.log("3. Add http://localhost:3000/oauth2callback to Authorized Redirect URIs");
  console.log("4. Paste GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into .env.local, then run this script again.");
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.compose"],
});

console.log("\n🔗 Open this URL in your browser to authorize Gmail API access for evanyap7@gmail.com:\n");
console.log(authUrl);
console.log("\nWaiting for authentication...\n");

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === "/oauth2callback") {
      const code = reqUrl.query.code;
      if (code) {
        const { tokens } = await oauth2Client.getToken(code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Authentication Successful!</h1><p>You can close this tab and return to the terminal.</p>");

        console.log("✅ Successfully retrieved tokens!\n");
        if (tokens.refresh_token) {
          console.log("Add this to your .env.local:");
          console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        } else {
          console.log("⚠️ No refresh token returned. (Try re-running with prompt=consent or revoking app access).");
        }
        server.close();
        process.exit(0);
      }
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Error: ${err.message}`);
    console.error("Error exchanging code for tokens:", err);
    server.close();
    process.exit(1);
  }
});

server.listen(3000, () => {
  console.log("Local callback server listening on http://localhost:3000/oauth2callback");
});
