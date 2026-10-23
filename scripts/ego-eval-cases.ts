export interface EgoEvalCase {
  message: string;
  /** Tools that must all be called (extra tools are allowed). */
  expectTools: string[];
  /** True when the correct behavior is to answer directly without any tool. */
  expectNone?: boolean;
  inputMode?: "text" | "voice";
  workoutActive?: boolean;
  description: string;
}

export const EGO_EVAL_CASES: EgoEvalCase[] = [
  { message: "spent $6.20 for lunch", expectTools: ["askFinanceAgent"], description: "Log an expense" },
  { message: "earned $100 from freelance work", expectTools: ["askFinanceAgent"], description: "Log income" },
  { message: "how much did I spend this month?", expectTools: ["askFinanceAgent"], description: "Spending summary" },
  { message: "how much did I spend on Grab this month?", expectTools: ["askFinanceAgent"], description: "Merchant query" },
  { message: "delete my coffee expense", expectTools: ["askFinanceAgent"], description: "Delete a transaction" },
  { message: "set my monthly budget to $600", expectTools: ["askFinanceAgent"], description: "Set budget" },
  { message: "cap dining at $150 a month", expectTools: ["askFinanceAgent"], description: "Category cap" },
  { message: "Add gym tomorrow", expectTools: ["calendar_add"], description: "All-day event" },
  { message: "Schedule floorball tomorrow from 8 pm to 9:30 pm", expectTools: ["calendar_add"], description: "Timed event" },
  { message: "What's on my calendar today?", expectTools: ["calendar_view"], description: "Agenda" },
  { message: "when am I free tomorrow?", expectTools: ["calendar_free_slots"], description: "Free slots" },
  { message: "move my gym session to 5pm tomorrow", expectTools: ["calendar_reschedule"], description: "Reschedule" },
  { message: "delete gym tomorrow from personal", expectTools: ["calendar_delete_search"], description: "Delete event" },
  { message: "Add buy groceries to my to-do list", expectTools: ["todo_add"], description: "Add todo" },
  { message: "Remind me to call John today", expectTools: ["todo_add"], description: "Reminder todo" },
  { message: "I'm done with buy groceries", expectTools: ["todo_complete"], description: "Complete todo" },
  { message: "add to my todo list: 1. buy milk 2. do laundry", expectTools: ["todo_add"], description: "Batch todos" },
  { message: "what do I have to do today?", expectTools: ["todo_view"], description: "View todos" },
  { message: "Draft an email to alex@example.com about project update", expectTools: ["email_draft"], description: "Email draft" },
  { message: "split $60 bill with Alice and Bob", expectTools: ["split_bill"], description: "Split bill" },
  { message: "who owes me money?", expectTools: ["iou_summary"], description: "IOU summary" },
  { message: "remember that Alice's birthday is June 15", expectTools: ["memory_save"], description: "Save memory" },
  { message: "what is Alice's birthday?", expectTools: ["memory_recall"], description: "Recall memory" },
  { message: "remind me to pay rent on the 1st every month", expectTools: ["recurring_add"], description: "Recurring task" },
  { message: "show my subscriptions", expectTools: ["recurring_view"], description: "View recurring" },
  { message: "undo", expectTools: ["undo"], description: "Undo" },
  { message: "I'm going to the gym", expectTools: ["askWorkoutAgent"], description: "Start workout" },
  { message: "show my workout stats", expectTools: ["askWorkoutAgent"], description: "Workout stats" },
  { message: "what's the capital of Australia?", expectTools: ["webSearch"], description: "General question" },
  {
    message: "spent $6 on lunch and add gym tomorrow at 7pm",
    expectTools: ["askFinanceAgent", "calendar_add"],
    description: "Multi-step: finance plus calendar",
  },
  { message: "hey", expectTools: [], expectNone: true, description: "Greeting needs no tool" },
  {
    message: "twelve fifty for chicken rice",
    expectTools: ["askFinanceAgent"],
    inputMode: "voice",
    description: "Voice: spoken amount",
  },
  {
    message: "remind me to call mom at five pm",
    expectTools: ["todo_add"],
    inputMode: "voice",
    description: "Voice: reminder",
  },
  {
    message: "one hundred times five",
    expectTools: ["askWorkoutAgent"],
    inputMode: "voice",
    workoutActive: true,
    description: "Voice: spoken set during an active workout",
  },
  {
    message: "skip the next exercise",
    expectTools: ["askWorkoutAgent"],
    workoutActive: true,
    description: "Active workout: skip",
  },
  {
    message: "checked off my reading habit",
    expectTools: ["habit_log"],
    description: "Log habit done",
  },
  {
    message: "show my habits and streaks",
    expectTools: ["habit_view"],
    description: "View habits",
  },
  {
    message: "check my unread emails",
    expectTools: ["inbox_triage"],
    description: "Inbox triage",
  },
  {
    message: "sync my recent Grab transactions",
    expectTools: ["sync_transactions"],
    description: "Sync transactions",
  },
  {
    message: "how much Claude credit do I have left?",
    expectTools: ["credits_view"],
    description: "Credits view",
  },
  {
    message: "give me my morning brief",
    expectTools: ["daily_briefing"],
    description: "Morning brief on demand",
  },
];
