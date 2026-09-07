# Real-Time DBS PayLah Email Receipt Setup

Whenever you pay via DBS PayLah! or PayNow QR, DBS sends an email receipt to your Gmail. This guide sets up real-time webhook logging so the bot automatically logs the expense to your Google Sheet and sends you an interactive Telegram notification card the moment the email hits your inbox!

---

## Option 1: Google Cloud Pub/Sub (Official Google Push Notifications)

This is the standard, official way Gmail sends real-time webhooks directly to web apps.

### Step 1: Open Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Make sure the project selected in the top bar is the same project where your OAuth Credentials / Service Account were created.

### Step 2: Enable Cloud Pub/Sub API
1. Search for **Cloud Pub/Sub API** in the top search bar.
2. Click **Enable** (if not already enabled).

### Step 3: Create a Pub/Sub Topic
1. Open the [Pub/Sub Topics Console](https://console.cloud.google.com/cloudpubsub/topic/list?project=perfect-stock-507203-h1) directly, or:
   * Type **Pub/Sub** in the top Google Cloud search bar and click **Topics**.
   * Or click the hamburger menu (☰ top left) -> scroll down to **Pub/Sub** -> **Topics**.
2. Click **Create Topic** (at the top of the table).
3. **Topic ID**: `gmail-notifications`
4. Leave default settings and click **Create**.
5. Once created, copy the **Topic name** (it will be: `projects/perfect-stock-507203-h1/topics/gmail-notifications`).

### Step 4: Grant Gmail Publish Permissions
1. In the Topic details page, click the **Permissions** tab on the right side panel (or click **Add Principal**).
2. **New principals**:
   ```
   gmail-api-push@system.gserviceaccount.com
   ```
3. **Role**: Select **Pub/Sub Publisher**.
4. Click **Save**.

### Step 5: Create a Push Subscription
1. Under **Subscriptions** (in the Pub/Sub menu), click **Create Subscription**.
2. **Subscription ID**: `gmail-webhook-sub`.
3. **Select a Cloud Pub/Sub topic**: Choose the topic you created above.
4. **Delivery type**: Select **Push**.
5. **Endpoint URL**:
   ```
   https://telegram-personal-assistant-sigma.vercel.app/api/gmail-webhook?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322
   ```
   *(Replace with your custom secret if you customized `APPLE_WALLET_SECRET` or `GMAIL_WEBHOOK_SECRET`)*
6. Leave other settings at default and click **Create**.

### Step 6: Activate Watch Subscription
Run this command in your project folder:
```bash
npm run setup-gmail-watch projects/perfect-stock-507203-h1/topics/gmail-notifications
```
You will see:
```text
🎉 SUCCESS! Gmail push notifications are active!
Incoming DBS PayLah receipts will now trigger your webhook automatically in real time!
```

---

## Option 2: 1-Click Google Apps Script (No Cloud Console Needed)

If you prefer not to touch Google Cloud Pub/Sub, you can set up a 1-minute Google Apps Script trigger in your Google account:

1. Go to [script.google.com](https://script.google.com/) and click **New project**.
2. Paste this script:
```javascript
function checkPayLahReceipts() {
  const threads = GmailApp.search('from:(dbs.com) ("PayLah" OR "PayNow") is:unread', 0, 5);
  if (threads.length > 0) {
    const url = "https://telegram-personal-assistant-sigma.vercel.app/api/gmail-webhook?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322";
    UrlFetchApp.fetch(url, { method: "POST" });
  }
}
```
3. Click **Triggers** (clock icon on the left menu) -> **Add Trigger**.
   * Function: `checkPayLahReceipts`
   * Event source: `Time-driven`
   * Type: `Minutes timer` -> `Every minute` (or every 5 minutes).
4. Click **Save** and authorize.

---

## How It Works in Action
1. You make a PayLah! / PayNow payment.
2. DBS emails your receipt.
3. Your webhook receives the event, inspects the receipt, logs it to `Transactions`, and sends you a Telegram card:
   ```text
   🟣 DBS PayLah! Expense Synced!

   • Amount: SGD 8.60
   • Merchant: FOMO PAY PTE. LTD.
   • Category: Dining
   • Recorded: 07 Sept 2026 @ 3:13 PM

   [ ✏️ Change Category ]  [ 🗑️ Undo / Delete ]
   ```
4. Only newly arrived receipts are logged — older transactions are never re-logged.
