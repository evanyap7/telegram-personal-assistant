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

  const mediaType =
    downloadResponse.headers.get("content-type") ?? "image/jpeg";

  if (!mediaType.startsWith("image/")) {
    throw new Error("Telegram file was not recognized as an image.");
  }

  return {
    data: new Uint8Array(buffer),
    mediaType,
  };
}