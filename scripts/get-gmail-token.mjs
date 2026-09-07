import http from "node:http";
import url from "node:url";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

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
  scope: [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
});

console.log("\n🔗 Open this URL in your browser to authorize Gmail API access for evanyap7@gmail.com:\n");
console.log(authUrl);
console.log("\nWaiting for authentication...\n");

async function exchangeAndSaveCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  console.log("\n✅ Successfully retrieved tokens!\n");
  if (tokens.refresh_token) {
    console.log("Add this to your .env.local and Vercel environment variables:");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    // Auto-update .env.local if present
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, "utf-8");
      if (content.includes("GOOGLE_REFRESH_TOKEN=")) {
        content = content.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      } else {
        content += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
      }
      fs.writeFileSync(envPath, content, "utf-8");
      console.log("🎉 Automatically updated GOOGLE_REFRESH_TOKEN in .env.local!");
    }
  } else {
    console.log("⚠️ No refresh token returned. (Try re-running with prompt=consent or revoking app access).");
  }
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === "/oauth2callback") {
      const code = reqUrl.query.code;
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Authentication Successful!</h1><p>You can close this tab and return to the terminal.</p>");
        server.close();
        await exchangeAndSaveCode(code);
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

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log("⚠️ Note: Port 3000 is currently busy. After clicking Allow in your browser, simply copy the URL from your address bar and paste it below:\n");
  }
});

server.listen(3000, () => {
  console.log("Local callback server listening on http://localhost:3000/oauth2callback");
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("👉 Or paste the redirected URL (or code) here: ", async (input) => {
  try {
    let code = input.trim();
    if (code.includes("code=")) {
      const fullUrl = code.startsWith("http") ? code : `http://localhost:3000/${code}`;
      const parsed = new URL(fullUrl);
      code = parsed.searchParams.get("code") || code;
    }
    if (code) {
      server.close();
      await exchangeAndSaveCode(code);
    }
  } catch (err) {
    console.error("Failed to exchange code:", err.message);
    process.exit(1);
  }
});
