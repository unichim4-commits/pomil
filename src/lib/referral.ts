import { randomInt } from "node:crypto";

// Bỏ các ký tự dễ nhầm (0, O, 1, I, L)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateReferralCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
