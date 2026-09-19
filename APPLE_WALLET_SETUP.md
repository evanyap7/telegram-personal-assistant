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

#### ⚠️ 4. Online or In-App Purchases (Not physical NFC taps)
- The iOS **Transaction** automation trigger **only** fires for **physical, in-person NFC contactless taps** at store payment terminals (e.g. MRT/bus, 7-Eleven, Starbucks, NTUC FairPrice).
- It does **NOT** fire for online Safari checkouts or in-app payments (e.g. Grab, Shopee, Deliveroo, App Store). Those are online card payments, not Apple Wallet terminal transactions.

#### ⚠️ 5. "Run Immediately" Setting
- In Shortcuts > Automation tab > tap your Automation:
- Make sure **"Run Immediately"** is selected (NOT "Run After Confirmation").
- Make sure **"Notify When Run"** is toggled **OFF**.

---

### 3. Test with a real Apple Pay purchase
Next time you buy a coffee, ride MRT/bus, or pay for groceries with Apple Pay:
1. Double-click the side button on your **iPhone** and tap the contactless payment terminal.
2. Within 2-3 seconds, a Telegram notification will arrive confirming the recorded expense.
3. If the AI inferred the category as "General" or you want to adjust it, tap **`[✏️ Change Category]`** to switch it with one tap.
