/**
 * Fixture inputs shared by the benchmark scripts. These mirror the
 * example commands in README.md so the benchmark exercises realistic,
 * representative traffic rather than best-case or worst-case inputs.
 */

export const INTENT_TEST_MESSAGES: string[] = [
  "spent $6.20 for lunch",
  "spent 23.50 SGD on groceries",
  "earned $100 from freelance work",
  "Add gym tomorrow",
  "Schedule floorball tomorrow from 8 pm to 9:30 pm",
  "Add a project meeting next Friday from 2 pm to 3 pm in work",
  "What's on my calendar today?",
  "how much did I spend this month?",
  "delete my coffee expense",
  "Add buy groceries to my to-do list",
  "Remind me to call John today",
  "I'm done with buy groceries",
  "Draft an email to alex@example.com about project update",
  "delete gym tomorrow from personal",
];

export const RECEIPT_EMAIL_FIXTURES: Array<{ subject: string; body: string }> = [
  {
    subject: "Your Shopee order has been confirmed",
    body: "Thank you for your order. Order Total: S$45.90. Item: Wireless Mouse. Payment Method: ShopeePay. Order ID: SP20260912001.",
  },
  {
    subject: "Amazon.sg: Your order has shipped",
    body: "Your order of 'USB-C Cable 2m' for S$12.40 has shipped and will arrive in 2-3 days. Charged to card ending 4321.",
  },
  {
    subject: "Payment Confirmation - Foodpanda",
    body: "Your order from Toast Box has been confirmed. Total charged: S$8.50 via PayNow. Order number FP-88213.",
  },
  {
    subject: "Netflix: Your payment receipt",
    body: "Thank you for being a Netflix member. We've charged S$16.98 to your card ending 9981 for your monthly subscription.",
  },
  {
    subject: "SP Group: Your latest utilities bill",
    body: "Your electricity and water bill for August 2026 is S$132.10, due 30 Sep 2026. Account 1122334455.",
  },
  {
    subject: "Deliveroo Order Receipt",
    body: "Your order from Wingstop (2x Chicken Combo) totalling S$24.80 was successfully charged to your saved card.",
  },
];

export const MODEL_IDS = [
  "gemini-flash-lite-latest",
  "gemini-3.6-flash",
  "sonar",
] as const;
