import { z } from "zod";

import { addTransaction } from "@/lib/finance";
import { sendTelegramMessage } from "@/lib/telegram";

const telegramUpdateSchema = z.object({
  message: z
    .object({
      chat: z.object({
        id: z.number(),
      }),
      from: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
    })
    .optional(),
});

const financeAddSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().positive(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(200),
});

function helpText() {
  return [
    "Personal Assistant commands:",
    "",
    "/finance add <income|expense> | <amount> | <currency> | <category> | <description>",
    "/finance list",
    "",
    "Example:",
    "/finance add expense | 14.80 | SGD | Food | Lunch at NUS",
    "",
    "Calendar commands will be added after finance is verified.",
  ].join("\n");
}

export async function POST(request: Request) {
  const secretHeader = request.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = telegramUpdateSchema.parse(await request.json());
    const message = update.message;

    if (!message?.text) {
      return Response.json({ ok: true });
    }

    const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);

    if (!allowedUserId || message.from.id !== allowedUserId) {
      return new Response("Forbidden", { status: 403 });
    }

    const text = message.text.trim();

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(message.chat.id, helpText());
      return Response.json({ ok: true });
    }

    if (text.startsWith("/finance add ")) {
      const rawFields = text
        .replace("/finance add ", "")
        .split("|")
        .map((field) => field.trim());

      if (rawFields.length !== 5) {
        await sendTelegramMessage(
          message.chat.id,
          "Invalid format.\n\nUse:\n/finance add expense | 14.80 | SGD | Food | Lunch at NUS"
        );
        return Response.json({ ok: true });
      }

      const [type, amount, currency, category, description] = rawFields;

      const input = financeAddSchema.parse({
        type,
        amount,
        currency,
        category,
        description,
      });

      const transaction = await addTransaction(input);

      await sendTelegramMessage(
        message.chat.id,
        [
          "Transaction added.",
          `ID: ${transaction.transactionId}`,
          `Type: ${input.type}`,
          `Amount: ${input.amount.toFixed(2)} ${input.currency.toUpperCase()}`,
          `Category: ${input.category}`,
          `Description: ${input.description}`,
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    await sendTelegramMessage(
      message.chat.id,
      "I did not understand that command.\n\nUse /help to see supported commands."
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);

    return Response.json(
      { ok: false, error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}