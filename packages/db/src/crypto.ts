/**
 * AES-256-GCM encryption for OAuth tokens and secrets.
 *
 * Key: EDDA_ENCRYPTION_KEY env var (32 bytes, base64-encoded).
 * Format: base64(iv):base64(ciphertext):base64(authTag)
 * No fallback — fails loudly if key is not set.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM

let _cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const raw = process.env.EDDA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "EDDA_ENCRYPTION_KEY is required for OAuth connections. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `EDDA_ENCRYPTION_KEY must be 32 bytes (got ${key.length}). ` +
        "Generate with: openssl rand -base64 32",
    );
  }
  _cachedKey = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format — expected iv:ciphertext:tag");
  }

  const [ivB64, encB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
}
