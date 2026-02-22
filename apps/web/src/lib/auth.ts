import { createHmac, timingSafeEqual } from "crypto";

const SESSION_PAYLOAD = "edda_session_v1";

export const COOKIE_NAME = "edda_session";
export const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function computeSessionToken(password: string): string {
  return createHmac("sha256", password).update(SESSION_PAYLOAD).digest("hex");
}

export function validateSession(cookieValue: string): boolean {
  const password = process.env.EDDA_PASSWORD;
  if (!password) return false;
  const expected = computeSessionToken(password);
  try {
    return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
  } catch {
    return false;
  }
}
