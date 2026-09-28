import {
  calculateBillSplit,
  recordIOUs,
  getIOUSummary,
  settleIOU,
  formatSplitBillMessage,
  formatIOUSummaryMessage,
  type AddIOUInput,
} from "@/lib/split";
import {
  sendTelegramMessage,
  answerTelegramCallback,
  type InlineKeyboardMarkup,
} from "@/lib/telegram";

export async function handleSplitBillAction(params: {
  chatId: number;
  intent: {
    total?: number;
    subtotal?: number;
    people: string[];
    tipPercent?: number;
    taxPercent?: number;
    description?: string;
    payer?: string;
  };
}): Promise<void> {
  const { chatId, intent } = params;
  let people = (intent.people || []).map((p) => p.trim()).filter(Boolean);
  if (people.length === 0) {
    people = ["Me", "Friend"];
  } else if (
    !people.some(
      (p) =>
        p.toLowerCase() === "me" ||
        p.toLowerCase() === "myself" ||
        p.toLowerCase() === "i"
    )
  ) {
    people = ["Me", ...people];
  }

  const result = calculateBillSplit({
    total: intent.total,
    subtotal: intent.subtotal,
    people,
    tipPercent: intent.tipPercent,
    taxPercent: intent.taxPercent,
  });

  const description = intent.description || "Bill split";
  const baseMessage = formatSplitBillMessage(result, description);

  // Filter debtors (everyone other than "Me")
  const debtors = result.shares.filter(
    (s) => s.name.toLowerCase() !== "me" && s.name.toLowerCase() !== "i"
  );

  if (debtors.length > 0) {
    const iouInputs: AddIOUInput[] = debtors.map((d) => ({
      payer: intent.payer || "Me",
      debtor: d.name,
      amount: d.amount,
      currency: "SGD",
      description,
    }));

    try {
      const recorded = await recordIOUs(iouInputs);
      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: recorded.map((r) => [
          {
            text: `✅ Mark ${r.debtor} settled ($${r.amount.toFixed(2)})`,
            callback_data: `iou_settle:${r.iouId}`,
          },
        ]),
      };

      await sendTelegramMessage(
        chatId,
        `${baseMessage}\n\n📝 *Logged ${debtors.length} IOU(s) to debt ledger.*`,
        keyboard
      );
    } catch (err) {
      console.error("Failed to record IOUs:", err);
      await sendTelegramMessage(chatId, baseMessage);
    }
  } else {
    await sendTelegramMessage(chatId, baseMessage);
  }
}

export async function handleIOUSummaryAction(params: {
  chatId: number;
  person?: string;
}): Promise<void> {
  const { chatId, person } = params;
  try {
    const summary = await getIOUSummary();
    let text = formatIOUSummaryMessage(summary);

    if (person) {
      const pLower = person.toLowerCase().trim();
      const pBalance = Object.entries(summary.byPerson).find(([k]) =>
        k.toLowerCase().includes(pLower)
      );
      if (pBalance) {
        const [name, bal] = pBalance;
        text =
          `⚖️ *IOU with ${name}*:\n\n` +
          (bal.net > 0
            ? `🟢 ${name} owes you *$${bal.net.toFixed(2)} SGD*`
            : bal.net < 0
            ? `🔴 You owe ${name} *$${Math.abs(bal.net).toFixed(2)} SGD*`
            : `All even with ${name}!`);
      } else {
        text = `No active IOU records found for “${person}”.`;
      }
    }

    const unsettledOwedToMe = summary.records.filter(
      (r) => r.payer.toLowerCase() === "me" && r.status === "unsettled"
    );

    let keyboard: InlineKeyboardMarkup | undefined;
    if (unsettledOwedToMe.length > 0) {
      keyboard = {
        inline_keyboard: unsettledOwedToMe.slice(0, 5).map((r) => [
          {
            text: `✅ Settle ${r.debtor} ($${r.amount.toFixed(2)})`,
            callback_data: `iou_settle:${r.iouId}`,
          },
        ]),
      };
    }

    await sendTelegramMessage(chatId, text, keyboard);
  } catch (err) {
    console.error("Failed to get IOU summary:", err);
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not retrieve IOU summary. Make sure Google Sheets is configured."
    );
  }
}

export async function handleIOUSettleCallback(params: {
  callbackId: string;
  callbackData: string;
  chatId: number;
}): Promise<boolean> {
  const { callbackId, callbackData, chatId } = params;
  const parts = callbackData.split(":");
  const iouId = parts[1];

  if (!iouId) {
    await answerTelegramCallback(callbackId, "Invalid IOU ID.");
    return false;
  }

  try {
    const updated = await settleIOU(iouId);
    if (!updated) {
      await answerTelegramCallback(callbackId, "IOU not found or already settled.");
      return true;
    }

    await answerTelegramCallback(
      callbackId,
      `Settled $${updated.amount.toFixed(2)} with ${updated.debtor}!`
    );

    await sendTelegramMessage(
      chatId,
      `✅ *IOU Settled*: ${updated.debtor}'s debt of *$${updated.amount.toFixed(2)} SGD* (${updated.description}) marked as settled.`
    );
    return true;
  } catch (err) {
    console.error("Error settling IOU:", err);
    await answerTelegramCallback(callbackId, "Failed to settle IOU.");
    return false;
  }
}

export async function handleSplitCommand(params: {
  chatId: number;
  text: string;
}): Promise<void> {
  const { chatId, text } = params;
  const clean = text.replace(/^\/split\s*/i, "").trim();
  if (!clean) {
    await sendTelegramMessage(
      chatId,
      "ℹ️ *Usage*: `/split <amount> <person1> <person2>...`\nExample: `/split 60 Alex Ben`"
    );
    return;
  }

  const parts = clean.split(/\s+/);
  const amountStr = parts[0]?.replace("$", "");
  const total = parseFloat(amountStr || "");

  if (isNaN(total) || total <= 0) {
    await sendTelegramMessage(
      chatId,
      "⚠️ Please provide a valid total amount. Example: `/split 80 Alex Ben`"
    );
    return;
  }

  const rawPeople = parts.slice(1);
  const forIdx = rawPeople.findIndex((p) => p.toLowerCase() === "for");
  let people: string[] = [];
  let description = "Shared bill";

  if (forIdx !== -1) {
    people = rawPeople.slice(0, forIdx);
    description = rawPeople.slice(forIdx + 1).join(" ") || "Shared bill";
  } else {
    people = rawPeople;
  }

  await handleSplitBillAction({
    chatId,
    intent: {
      total,
      people,
      description,
    },
  });
}

export async function handleOwedCommand(params: {
  chatId: number;
  text: string;
}): Promise<void> {
  const { chatId, text } = params;
  const person = text.replace(/^\/owed\s*/i, "").trim() || undefined;
  await handleIOUSummaryAction({ chatId, person });
}
