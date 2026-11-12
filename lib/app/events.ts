/** One inline button as the app renders it; `data` is the Telegram callback_data. */
export type AppButton = { text: string; data: string };

/** Events streamed to the app for one turn, framed as server-sent events by `encodeSse`. */
export type AppEvent =
  | { type: "thinking" }
  | { type: "transcript"; text: string }
  | { type: "message"; id: number; text: string; buttons?: AppButton[][] }
  | { type: "edit"; id: number; text: string; buttons?: AppButton[][] }
  | { type: "buttons_removed"; id: number }
  | { type: "toast"; text?: string }
  | { type: "document"; filename: string; content: string; caption?: string }
  | { type: "done"; status?: string }
  | { type: "error"; message: string };

/**
 * One SSE frame: "data: <json>\n\n". JSON.stringify escapes newlines inside strings,
 * so the payload is always a single data line.
 */
export function encodeSse(event: AppEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
