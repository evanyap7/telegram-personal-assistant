import type { AppEvent } from "./events";

function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function parseFrame(frame: string): AppEvent | null {
  // Lines starting with ":" are SSE comments and are ignored; only data lines count.
  const data = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isAppEvent(parsed) ? parsed : null;
  } catch {
    return null; // a malformed frame is skipped; the stream continues
  }
}

/** Reads a text/event-stream body and calls `onEvent` for each well-formed data frame. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (e: AppEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (frame: string) => {
    const e = parseFrame(frame);
    if (e) onEvent(e);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let m: RegExpMatchArray | null;
    while ((m = buffer.match(/\r?\n\r?\n/)) && m.index !== undefined) {
      emit(buffer.slice(0, m.index));
      buffer = buffer.slice(m.index + m[0].length);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) emit(buffer);
}
