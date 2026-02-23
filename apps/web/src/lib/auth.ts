const SESSION_PAYLOAD = "edda_session_v1";

export const COOKIE_NAME = "edda_session";
export const THIRTY_DAYS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

async function hmacSha256(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeSessionToken(password: string): Promise<string> {
  return hmacSha256(password, SESSION_PAYLOAD);
}

export async function validateSession(cookieValue: string): Promise<boolean> {
  const password = process.env.EDDA_PASSWORD;
  if (!password) return false;
  const expected = await computeSessionToken(password);
  if (cookieValue.length !== expected.length) return false;
  // Constant-time comparison via subtle.timingSafeEqual where available,
  // otherwise byte-by-byte XOR (still constant-time in iteration count)
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
