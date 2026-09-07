# 📱 Apple Pay & Apple Wallet Setup Guide

Connect your Telegram Personal Assistant to your Apple Wallet so every Apple Pay purchase is automatically logged to Google Sheets and confirmed via Telegram in real time.

---

## ⚡ How It Works

1. You tap your iPhone or Apple Watch to pay with **Apple Pay** (or use any credit/debit card in Apple Wallet).
2. iOS 17+ triggers a **Shortcuts Personal Automation** in the background.
3. The shortcut sends the transaction details (Amount, Merchant, Card Name, Date) to your assistant webhook.
4. Your assistant auto-categorizes the expense (e.g. Dining, Transport, Groceries) and saves it to your Google Sheet.
5. You immediately get a Telegram notification with inline action buttons:
   - **`[✏️ Change Category]`** (quickly switch category with 1 tap)
   - **`[🗑️ Undo / Delete]`** (soft-deletes the transaction if you tapped by mistake)

---

## 🛠️ Step-by-Step iPhone Setup (Takes ~2 minutes)

### Prerequisites
- iPhone running **iOS 17 or newer**
- Built-in **Shortcuts** app (preinstalled on iOS)
- Your deployed assistant URL (e.g. `https://your-app.vercel.app`)

---

### Step 1: Open Shortcuts & Create Automation

1. Open the **Shortcuts** app on your iPhone.
2. Tap the **Automation** tab at the bottom center.
3. Tap the **`+`** button in the top-right corner (or **New Automation**).
4. Scroll down and select **Transaction**.

---

### Step 2: Configure the Transaction Trigger

1. **Card**: Select **Any Card** (or select specific cards you want to track).
2. **Category**: Select **Any Category**.
3. **Merchant**: Select **Any Merchant**.
4. **When**: Choose **Run Immediately**.
   - ⚠️ *Important:* Ensure **"Notify When Run"** is toggled **OFF** (so it runs silently in the background without asking for confirmation every time).
5. Tap **Next** in the top right.

---

### Step 3: Add the Webhook Action

1. Tap **New Blank Automation** (or **Add Action**).
2. Tap **Add Action** and search for **"Get Contents of URL"** (under Web / Network).
3. Tap **Get Contents of URL** to add it.

Now configure the fields:

#### A. URL Field
Set the URL to your assistant endpoint with your secret key:

```text
https://<YOUR-VERCEL-DOMAIN>/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322
```

> Replace `<YOUR-VERCEL-DOMAIN>` with your live assistant domain (e.g. `https://telegram-personal-assistant-xxx.vercel.app`).

#### B. Expand Arrow (Options)
Tap the small arrow **`>`** next to the URL to expand options:
- **Method**: Change from `GET` to **`POST`**.
- **Headers**: (Optional if using `?key=` query param, or add header `x-api-key`: `d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322`).
- **Request Body**: Change from `JSON` / None to **JSON**.

#### C. Add JSON Fields
Tap **Add new field** for each of the following:

| Key | Type | Value (Select from Shortcut Input) |
|---|---|---|
| `amount` | **Number** or **Text** | Tap variable -> Select **Shortcut Input** -> choose **Amount** |
| `merchant` | **Text** | Tap variable -> Select **Shortcut Input** -> choose **Merchant** |
| `card` | **Text** | Tap variable -> Select **Shortcut Input** -> choose **Card** (or Account) |
| `category` | **Text** | Tap variable -> Select **Shortcut Input** -> choose **Category** |
| `currency` | **Text** | Tap variable -> Select **Shortcut Input** -> choose **Currency Code** (or type `SGD`) |

> 💡 *Tip on Shortcut Input*: When you tap inside the value field, a suggestion bar appears above your keyboard. Tap **Shortcut Input**, then tap the blue variable pill to select the specific attribute (Amount, Merchant, Card, etc.).

---

### Step 4: Save and Finish

1. Tap **Done** in the top-right corner.
2. That's it! Your automation is active.

---

## 🧪 Testing Your Setup

### 1. Test from your computer (Terminal / Browser)

You can verify your endpoint right now with `curl`:

```bash
curl -X POST "https://<YOUR-VERCEL-DOMAIN>/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "4.20",
    "merchant": "Starbucks",
    "card": "DBS Altitude"
  }'
```

Expected response:
```json
{
  "success": true,
  "transactionId": "txn_...",
  "amount": 4.2,
  "currency": "SGD",
  "merchant": "Starbucks",
  "category": "Dining",
  "description": "Starbucks (Apple Pay - DBS Altitude)"
}
```
And check your Telegram chat — you will receive an instant notification with category and undo buttons!

### 2. Test with a real Apple Pay purchase
Next time you buy a coffee, ride MRT/bus, or pay for groceries with Apple Pay:
1. Tap your iPhone / Apple Watch to pay.
2. Within 2-3 seconds, a Telegram notification will arrive confirming the recorded expense.
3. If the AI inferred the category as "General" or you want to adjust it, tap **`[✏️ Change Category]`** to switch it with one tap.
