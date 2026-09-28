import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.MEMORY_ENCRYPTION_KEY;
  if (!raw || raw.trim().length < 16) return null;
  // Derive a fixed-length 256-bit key from the configured secret.
  return createHash("sha256").update(raw.trim()).digest();
}

export function isSecretBoxConfigured(): boolean {
  return getKey() !== null;
}

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a value with AES-256-GCM. Returns null when MEMORY_ENCRYPTION_KEY
 * is not configured so callers can decide how to handle it.
 */
export function encryptSecret(plaintext: string): string | null {
  const key = getKey();
  if (!key) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a value produced by encryptSecret. Non-encrypted values are
 * returned unchanged; undecryptable values (wrong/missing key) return null.
 */
export function decryptSecret(value: string): string | null {
  if (!isEncryptedValue(value)) return value;

  const key = getKey();
  if (!key) return null;

  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
