import { InlineKeyboardMarkup } from "../telegram";

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "menu", description: "Open control panel" },
  { command: "gym", description: "Start workout or view strength stats" },
  { command: "agenda", description: "View today's schedule" },
  { command: "todo", description: "View active to-do list" },
  { command: "todotoday", description: "View today's tasks" },
  { command: "calendar", description: "Upcoming calendar events" },
  { command: "freeslots", description: "Find available free time windows" },
  { command: "finance", description: "Spending summary & quick commands" },
  { command: "budget", description: "Monthly budget & category caps" },
  { command: "finance_summary", description: "Monthly spending breakdown" },
  { command: "finance_list", description: "Recent active transactions" },
  { command: "reminders", description: "Check upcoming reminders" },
  { command: "habits", description: "Daily habit streaks" },
  { command: "recurring", description: "Subscriptions & recurring tasks" },
  { command: "split", description: "Split bill (e.g. /split 80 Alex Ben)" },
  { command: "owed", description: "IOU balances" },
  { command: "inbox", description: "Triage unread Gmail inbox" },
  { command: "sync", description: "Sync recent DBS & Grab transactions" },
  { command: "export", description: "Export monthly transactions CSV" },
  { command: "help", description: "Show full assistant guide" },
];

/**
 * Clean, compact 4-hub grid instead of 20 button clutter
 */
export function getCompactDashboardMarkup(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📅 Calendar", callback_data: "menu:calendar" },
        { text: "💰 Finances", callback_data: "menu:finance" },
      ],
      [
        { text: "🏋️ Workouts", callback_data: "menu:workout" },
        { text: "📋 Tasks & Habits", callback_data: "menu:tasks" },
      ],
    ],
  };
}

export function getCompactDashboardText(): string {
  return [
    "🤖 *Personal Assistant Control Panel*",
    "",
    "Tap a category below, type `/` for quick commands, or speak naturally:",
    "",
    "• 📅 *Calendar*: Daily agenda, 7-day schedule & free slots",
    "• 💰 *Finances*: Monthly spending, budget caps & sync",
    "• 🏋️ *Workouts*: School/CSC progressive overload tracking",
    "• 📋 *Tasks*: Single & batch to-dos, reminders & habits",
  ].join("\n");
}

export function getSubmenuMarkup(category: "calendar" | "finance" | "workout" | "tasks"): {
  text: string;
  markup: InlineKeyboardMarkup;
} {
  switch (category) {
    case "calendar":
      return {
        text: "📅 *Calendar Hub*\n\nView schedules or check reminders:",
        markup: {
          inline_keyboard: [
            [
              { text: "Today's Agenda", callback_data: "menu:agenda" },
              { text: "Next 7 Days", callback_data: "menu:cal_week" },
            ],
            [
              { text: "Find Free Slots", callback_data: "menu:freeslots" },
              { text: "Check Reminders", callback_data: "menu:reminders" },
            ],
            [{ text: "« Back to Dashboard", callback_data: "menu:home" }],
          ],
        },
      };

    case "finance":
      return {
        text: "💰 *Finance Hub*\n\nCheck balances, budgets, or sync transactions:",
        markup: {
          inline_keyboard: [
            [
              { text: "Monthly Summary", callback_data: "menu:finance_summary" },
              { text: "Recent Expenses", callback_data: "menu:finance_list" },
            ],
            [
              { text: "Budget Progress", callback_data: "menu:budget" },
              { text: "Sync DBS & Grab", callback_data: "menu:sync" },
            ],
            [{ text: "« Back to Dashboard", callback_data: "menu:home" }],
          ],
        },
      };

    case "workout":
      return {
        text: "🏋️ *Workout Hub*\n\nStart today's guided PH3 workout or view strength progress:",
        markup: {
          inline_keyboard: [
            [{ text: "🏋️ Start Today's Workout", callback_data: "menu:workout_start" }],
            [
              { text: "📊 Strength Stats", callback_data: "menu:workout_stats" },
              { text: "⚙️ Setup Dashboard Sheet", callback_data: "menu:workout_setup_sheet" },
            ],
            [{ text: "« Back to Dashboard", callback_data: "menu:home" }],
          ],
        },
      };

    case "tasks":
      return {
        text: "📋 *Tasks & Habits Hub*\n\nManage to-dos, recurring items, and streaks:",
        markup: {
          inline_keyboard: [
            [
              { text: "Active Tasks", callback_data: "menu:todos" },
              { text: "Today's Tasks", callback_data: "menu:todos_today" },
            ],
            [
              { text: "🔥 Habit Streaks", callback_data: "menu:habits" },
              { text: "🔁 Subscriptions", callback_data: "menu:recurring" },
            ],
            [{ text: "« Back to Dashboard", callback_data: "menu:home" }],
          ],
        },
      };
  }
}
