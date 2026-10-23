import {
  createHabit,
  formatHabitsSummary,
  listHabits,
  logHabitDone,
} from "../habits";
import { sendTelegramMessage } from "../telegram";

export async function handleHabitLogAction(params: {
  chatId: number;
  name: string;
}): Promise<{ completionStatus: string }> {
  const { chatId, name } = params;
  const result = await logHabitDone(name);
  await sendTelegramMessage(chatId, result.message);
  return { completionStatus: result.success ? "habit_logged" : "habit_not_found" };
}

export async function handleHabitViewAction(params: {
  chatId: number;
}): Promise<{ completionStatus: string }> {
  const { chatId } = params;
  const habits = await listHabits();
  const summary = formatHabitsSummary(habits);

  const markup =
    summary.buttons.length > 0
      ? { inline_keyboard: summary.buttons }
      : undefined;

  await sendTelegramMessage(chatId, summary.text, markup);
  return { completionStatus: "habit_view" };
}

export async function handleHabitAddAction(params: {
  chatId: number;
  name: string;
  frequency?: "daily" | "weekly";
}): Promise<{ completionStatus: string }> {
  const { chatId, name, frequency = "daily" } = params;
  const habit = await createHabit(name, frequency);
  await sendTelegramMessage(
    chatId,
    `✅ Now tracking *${habit.name}* (${habit.frequency}).`
  );
  return { completionStatus: "habit_added" };
}
