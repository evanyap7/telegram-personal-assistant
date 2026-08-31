type FinanceAddAction = {
  type: "finance_add";
  userId: number;
  expiresAt: number;
  payload: {
    type: "income" | "expense";
    amount: number;
    currency: string;
    category: string;
    description: string;
  };
};

type CalendarAddAction = {
  type: "calendar_add";
  userId: number;
  expiresAt: number;
  payload: {
    calendarName: "personal" | "work";
    title: string;
    start: string;
    end: string;
  };
};

type PendingAction = FinanceAddAction | CalendarAddAction;

type PendingActionInput =
  | Omit<FinanceAddAction, "expiresAt">
  | Omit<CalendarAddAction, "expiresAt">;

const pendingActions = new Map<string, PendingAction>();

function createToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function savePendingAction(action: PendingActionInput): string {
  const token = createToken();

  if (action.type === "finance_add") {
    pendingActions.set(token, {
      type: "finance_add",
      userId: action.userId,
      expiresAt: Date.now() + 5 * 60 * 1000,
      payload: action.payload,
    });
  } else {
    pendingActions.set(token, {
      type: "calendar_add",
      userId: action.userId,
      expiresAt: Date.now() + 5 * 60 * 1000,
      payload: action.payload,
    });
  }

  return token;
}

export function takePendingAction(
  token: string,
  userId: number
): PendingAction | null {
  const normalizedToken = token.trim().toUpperCase();
  const action = pendingActions.get(normalizedToken);

  if (!action) {
    return null;
  }

  pendingActions.delete(normalizedToken);

  if (action.userId !== userId || action.expiresAt < Date.now()) {
    return null;
  }

  return action;
}

export function cancelPendingActionsForUser(userId: number): number {
  let cancelled = 0;

  for (const [token, action] of pendingActions.entries()) {
    if (action.userId === userId) {
      pendingActions.delete(token);
      cancelled += 1;
    }
  }

  return cancelled;
}