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
https://telegram-personal-assistant-sigma.vercel.app/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322
```


#### B. Expand Arrow (Options)
Tap the small arrow **`>`** next to the URL to expand options:
- **Method**: Change from `GET` to **`POST`**.
- **Headers**: (Optional if using `?key=` query param, or add header `x-api-key`: `d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322`).
- **Request Body**: Change from `JSON` / None to **JSON**.

#### C. Add JSON Fields
Tap **Add new field** for each of the following (⚠️ **Critical:** Always set Type to **Text**, NOT Number. If set to Number, iOS Shortcuts will crash with a conversion error because Apple Pay amounts carry currency metadata):

| Key | Type | Value (Select from Shortcut Input) |
|---|---|---|
| `amount` | **Text** ⚠️ *(NOT Number)* | Tap variable -> Select **Shortcut Input** -> tap the blue pill -> choose **Amount** |
| `merchant` | **Text** | Tap variable -> Select **Shortcut Input** -> tap the blue pill -> choose **Merchant** |
| `card` | **Text** | Tap variable -> Select **Shortcut Input** -> tap the blue pill -> choose **Card** (or Account) |
| `category` | **Text** | Tap variable -> Select **Shortcut Input** -> tap the blue pill -> choose **Category** |
| `currency` | **Text** | Tap variable -> Select **Shortcut Input** -> tap the blue pill -> choose **Currency Code** (or type `SGD`) |
| `item` | **Text** *(Optional)* | See "How to Include What You Bought" below |

> ⚠️ **Crucial Step for Variables**: When you tap inside the value field, a suggestion bar appears above your keyboard with **Shortcut Input**. When you tap it, a blue variable pill labeled `[Shortcut Input]` appears in the field. You **MUST tap that blue pill again** to choose the specific attribute (e.g. `Amount`, `Merchant`, `Card`). If you don't tap it, Shortcuts passes the whole unparsed transaction object instead of the specific value!

---

### 🛍️ How to Include What You Bought (Item Name)

Apple Pay itself only receives the store name (Merchant) and Amount from the card terminal — it does not receive line items from the cashier. You have **two easy options** to include what you bought:

#### Option 1: Reply in Telegram (Easiest & Completely Silent)
Leave the shortcut as is! Whenever you pay with Apple Pay, you'll receive the Telegram notification. Simply **swipe right / reply to that Telegram message** with what you bought:
- *"bought iced matcha latte"*
- *"it was chicken rice and coffee"*
- *"item: gym protein shake"*

Your assistant's AI will automatically update the description in Google Sheets and re-categorize the expense!

#### Option 2: Ask for Input on your iPhone (Prompt right after tap)
If you want your iPhone to pop up a prompt asking *"What did you buy?"* every time you tap Apple Pay:
1. In your Shortcut, tap **Add Action** (or drag an action **above** the "Get Contents of URL" action).
2. Search for **"Ask for Input"** and select it.
3. Set prompt to: `What did you buy?` (Input type: `Text`).
4. In the JSON table under "Get Contents of URL", add the field:
   - Key: `item`
   - Value: Select **Provided Input** (the result of the Ask for Input action).

---

### Step 4: Save and Finish

1. Tap **Done** in the top-right corner.
2. That's it! Your automation is active.

---

## 🧪 Testing & Troubleshooting

### 1. Instant 1-Tap Browser Test (Verify your webhook right now)
Before worrying about iOS Shortcuts, you can verify that your backend endpoint, Google Sheets sync, and Telegram notifications are working right now:

👉 Open this link directly in Safari on your iPhone:
```text
https://telegram-personal-assistant-sigma.vercel.app/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322&amount=1.50&merchant=Test+Coffee
```
- Within 1–2 seconds, you should receive a Telegram notification: `💳 Apple Pay Expense Logged!`
- If you receive that message, your webhook backend and Google Sheets are **100% healthy and working**.
- You can immediately tap **`[🗑️ Undo / Delete]`** in Telegram to remove that test row from your Google Sheet.

---

### 2. Why Apple Pay might not be triggering (Troubleshooting Checklist)

If the instant browser test works, but your Apple Pay taps don't record expenses, check these **5 common reasons**:

#### ⚠️ 1. Amount Field Type was set to "Number" instead of "Text" (Most Common!)
- In Shortcuts > your Automation > Get Contents of URL > Request Body:
- Check the field `amount`.
- If its Type is set to **`Number`**, iOS Shortcuts **crashes silently** with a conversion error because Apple Pay's amount variable contains currency metadata.
- **Fix:** Change the Type of `amount` to **`Text`**. Our backend automatically handles parsing numbers from text.

#### ⚠️ 2. The Variable Pill wasn't expanded to choose the property
- In Shortcuts, when you insert `Shortcut Input`, it appears as a blue pill: `[Shortcut Input]`.
- You **must tap that blue pill** and select the specific attribute (e.g. `Amount`, `Merchant`, `Card`).
- If left as just `[Shortcut Input]`, Shortcuts sends the entire unparsed object.

#### ⚠️ 3. Tapping Apple Watch instead of iPhone
- Apple Watch transactions **do not reliably trigger iPhone Automations** due to Apple's security sandbox between watchOS and iOS.
- **Fix:** Test a payment by physically double-clicking and tapping your **iPhone** directly at a card terminal.

#### ⚠️ 4. Online or In-App Purchases vs Physical NFC Taps
- Apple designed the native iOS **Transaction** automation trigger to hook strictly into the iPhone's physical **NFC contactless chip** at payment terminals (e.g. MRT/bus, 7-Eleven, Starbucks, NTUC FairPrice).
- Because of Apple's security and privacy sandbox, Apple Pay checkouts inside apps (e.g. Grab, Shopee, Deliveroo) or in Safari web browsers **do not** emit a "Transaction" event to Shortcuts.
- **To log online and in-app Apple Pay purchases automatically**, follow the **Online & In-App Setup** below!

#### ⚠️ 5. "Run Immediately" Setting
- In Shortcuts > Automation tab > tap your Automation:
- Make sure **"Run Immediately"** is selected (NOT "Run After Confirmation").
- Make sure **"Notify When Run"** is toggled **OFF**.

---

## 🌐 Logging Online & In-App Apple Pay Purchases (Safari, Grab, Shopee, etc.)

Because Apple restricts the "Transaction" trigger to physical NFC taps, you can automatically capture online and in-app Apple Pay purchases using **two reliable methods**:

---

### ⭐ Method 1: Instant Bank SMS Automation (Recommended — Takes 1 minute)

Whenever you use Apple Pay in an app or on a website, your bank (DBS, POSB, UOB, OCBC, Citi, etc.) sends an **SMS transaction alert** within seconds. iOS Shortcuts natively allows **Message** triggers to run immediately in the background!

#### Step-by-Step Setup:

1. Open the **Shortcuts** app on your iPhone.
2. Tap the **Automation** tab at the bottom center.
3. Tap **`+`** (or **New Automation**).
4. Select **Message**.
5. Configure the trigger:
   - **Sender**: Select your bank (e.g., `DBS`, `POSB`, `UOB`, `OCBC`) OR
   - **Message Contains**: Type `charged` (or `SGD`, `spent`)
   - **When**: Select **Run Immediately** (toggle **"Notify When Run"** OFF)
6. Tap **Next**.
7. Tap **New Blank Automation** -> **Add Action**.
8. Search for and select **"Get Contents of URL"**.
9. Configure the action:
   - **URL**: `https://telegram-personal-assistant-sigma.vercel.app/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322`
   - Tap the arrow **`>`** to expand options:
     - **Method**: Change from `GET` to **`POST`**.
     - **Request Body**: Change to **JSON**.
     - Tap **Add new field**:
       - Key: `text`
       - Type: **Text**
       - Value: Select **Shortcut Input** (tap the blue pill and ensure it's set to **Content** or text)
10. Tap **Done** in the top right.

🎉 **Done!** Whenever your bank sends an SMS for an online or in-app Apple Pay purchase, Shortcuts silently forwards the text to your assistant, which uses deterministic regex and Gemini AI to parse the amount, merchant, and category, and logs it to Google Sheets!

*(Note: Duplicate protection prevents double-counting if the transaction was already logged by Gmail sync or physical tap).*

---

### ⭐ Method 2: Zero-Touch Gmail Push Sync (No Shortcuts Needed!)

When you buy on websites or in apps:
1. **Merchant Receipts**: Services like Grab, Shopee, Foodpanda, Deliveroo, Amazon, Apple, and airlines send an immediate receipt to your Gmail.
2. **Bank Transaction Alerts**: You can enable free real-time email alerts from your bank for card transactions.

#### To enable 1-cent card transaction email alerts in DBS / POSB:
1. Open the **DBS / POSB digibank** app.
2. Tap **More** (bottom right) > **App & Security Settings** > **Manage Notifications / Alerts**.
3. Under **Transaction Alerts** > **Card Transactions**:
   - Set the alert threshold to **$0.01** (or any amount).
   - Ensure **Email** alert is toggled **ON**.
4. Whenever you make any card purchase (online Apple Pay, in-app, or subscription), DBS immediately emails an alert to your Gmail.
5. Your assistant's built-in **Gmail Push Webhook** automatically catches the receipt, parses it, logs it to Google Sheets, and notifies you on Telegram!

---

### 🧪 Instant Online / SMS Webhook Test

You can test the assistant's unstructured SMS and text parser right now in Safari:

👉 Open this link in Safari:
```text
https://telegram-personal-assistant-sigma.vercel.app/api/apple-wallet?key=d1220059c7590b7eadb8d71f5064e28cb13e17dff0048322&text=DBS+Alert:+SGD+24.50+was+charged+to+your+DBS+Card+at+SHOPEE+on+28+Sep
```
- Within 1–2 seconds, you will receive a Telegram message: `💳 Apple Pay Expense Logged!` with **SHOPEE** and **SGD 24.50**.
- You can tap **`[🗑️ Undo / Delete]`** in Telegram to remove the test row immediately.
