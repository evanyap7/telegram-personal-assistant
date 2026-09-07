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
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.error("❌ Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN in .env.local.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
oauth2Client.setCredentials({ refresh_token: refreshToken });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

const args = process.argv.slice(2);

if (args.includes("--stop")) {
  console.log("Stopping Gmail push notifications...");
  try {
    await gmail.users.stop({ userId: "me" });
    console.log("✅ Gmail watch subscription stopped.");
  } catch (err) {
    console.error("❌ Error stopping watch:", err.message);
  }
  process.exit(0);
}

const topicName = args[0] || process.env.GMAIL_PUBSUB_TOPIC;

if (!topicName) {
  console.log(`
ℹ️ Usage:
  node scripts/setup-gmail-watch.mjs projects/<PROJECT_ID>/topics/<TOPIC_NAME>

Or set GMAIL_PUBSUB_TOPIC in .env.local:
  GMAIL_PUBSUB_TOPIC=projects/your-project-id/topics/your-topic-name
`);
  process.exit(1);
}

console.log(`Setting up Gmail watch for topic: ${topicName}...`);

try {
  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
    },
  });

  const expirationDate = res.data.expiration
    ? new Date(Number(res.data.expiration)).toLocaleString()
    : "Unknown";

  console.log("\n🎉 SUCCESS! Gmail push notifications are active!");
  console.log("-------------------------------------------------");
  console.log(`History ID:  ${res.data.historyId}`);
  console.log(`Expires at:  ${expirationDate} (Google automatically refreshes or renew every 7 days)`);
  console.log("-------------------------------------------------");
  console.log("Incoming DBS PayLah receipts will now trigger your webhook automatically in real time!");
} catch (error) {
  console.error("\n❌ Failed to setup Gmail watch:", error.message);
  if (error.code === 403 || error.status === 403) {
    console.log("\nCommon causes:");
    console.log("1. Pub/Sub Topic permission: Did you grant 'Publish' role to 'gmail-api-push@system.gserviceaccount.com' on the topic in Google Cloud Console?");
    console.log("2. Project: Ensure the topic belongs to the same Google Cloud project as your OAuth client.");
  }
}
