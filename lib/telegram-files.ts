function detectImageMediaType(
  contentTypeHeader: string | null,
  filePath: string,
  data: Uint8Array
): string {
  if (contentTypeHeader && contentTypeHeader.startsWith("image/")) {
    return contentTypeHeader.split(";")[0].trim();
  }

  // Check magic bytes
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }

  // Check file path extension
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";

  // Fallback default for Telegram photos
  return "image/jpeg";
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type TelegramFileResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
    file_size?: number;
  };
  description?: string;
};

function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  return token;
}

export async function downloadTelegramPhoto(fileId: string): Promise<{
  data: Uint8Array;
  mediaType: string;
}> {
  const botToken = getTelegramBotToken();

  const fileResponse = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(
      fileId
    )}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!fileResponse.ok) {
    const errorText = await fileResponse.text();
    throw new Error(
      `Telegram getFile request failed: ${fileResponse.status} ${errorText}`
    );
  }

  const filePayload =
    (await fileResponse.json()) as TelegramFileResponse;

  if (!filePayload.ok || !filePayload.result?.file_path) {
    throw new Error(
      `Telegram could not resolve this photo: ${
        filePayload.description ?? "Unknown error"
      }`
    );
  }

  if (
    filePayload.result.file_size &&
    filePayload.result.file_size > MAX_IMAGE_BYTES
  ) {
    throw new Error(
      "This image is too large. Please send an image smaller than 4 MB."
    );
  }

  const fileUrl =
    `https://api.telegram.org/file/bot${botToken}/` +
    filePayload.result.file_path;

  const downloadResponse = await fetch(fileUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!downloadResponse.ok) {
    const errorText = await downloadResponse.text();
    throw new Error(
      `Telegram photo download failed: ${downloadResponse.status} ${errorText}`
    );
  }

  const contentLength = Number(
    downloadResponse.headers.get("content-length") ?? "0"
  );

  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(
      "This image is too large. Please send an image smaller than 4 MB."
    );
  }

  const buffer = await downloadResponse.arrayBuffer();

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      "This image is too large. Please send an image smaller than 4 MB."
    );
  }

  const data = new Uint8Array(buffer);
  const mediaType = detectImageMediaType(
    downloadResponse.headers.get("content-type"),
    filePayload.result.file_path,
    data
  );

  return {
    data,
    mediaType,
  };
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

export async function downloadTelegramAudio(
  fileId: string,
  providedMimeType?: string
): Promise<{
  data: Uint8Array;
  mediaType: string;
}> {
  const botToken = getTelegramBotToken();

  const fileResponse = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(
      fileId
    )}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!fileResponse.ok) {
    const errorText = await fileResponse.text();
    throw new Error(
      `Telegram getFile request failed: ${fileResponse.status} ${errorText}`
    );
  }

  const filePayload =
    (await fileResponse.json()) as TelegramFileResponse;

  if (!filePayload.ok || !filePayload.result?.file_path) {
    throw new Error(
      `Telegram could not resolve this audio file: ${
        filePayload.description ?? "Unknown error"
      }`
    );
  }

  if (
    filePayload.result.file_size &&
    filePayload.result.file_size > MAX_AUDIO_BYTES
  ) {
    throw new Error(
      "This voice note is too large. Please send a voice note smaller than 10 MB."
    );
  }

  const fileUrl =
    `https://api.telegram.org/file/bot${botToken}/` +
    filePayload.result.file_path;

  const downloadResponse = await fetch(fileUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!downloadResponse.ok) {
    const errorText = await downloadResponse.text();
    throw new Error(
      `Telegram audio download failed: ${downloadResponse.status} ${errorText}`
    );
  }

  const buffer = await downloadResponse.arrayBuffer();

  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      "This audio is too large. Please send an audio note smaller than 10 MB."
    );
  }

  const data = new Uint8Array(buffer);
  const mediaType =
    providedMimeType ||
    downloadResponse.headers.get("content-type") ||
    "audio/ogg";

  return {
    data,
    mediaType,
  };
}