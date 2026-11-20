/**
 * Ghana phone helpers shared by the shop, checkout, till and dashboard.
 *
 * Accepts the usual ways people type a Ghana mobile number:
 *   0XXXXXXXXX, 233XXXXXXXXX, +233XXXXXXXXX, 00233XXXXXXXXX
 * with any spaces, dashes, dots or brackets. A mobile number is 9 digits
 * after the country code, starting 2x or 5x (024, 054, 055, 020, 050, 027,
 * 057, 026, 056, 059, 053, ...).
 */

const MOBILE_NINE = /^[25]\d{8}$/;

/** Strips everything except digits and a leading plus. */
function compact(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).trim().replace(/[\s\-().]/g, '');
}

/** The 9 national digits (without 0 / 233) when the input is a Ghana mobile number, else null. */
function nationalNine(input: unknown): string | null {
  let s = compact(input);
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;
  let nine: string;
  if (s.startsWith('00233') && s.length === 14) nine = s.slice(5);
  else if (s.startsWith('233') && s.length === 12) nine = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) nine = s.slice(1);
  else if (s.length === 9) nine = s;
  else return null;
  return MOBILE_NINE.test(nine) ? nine : null;
}

export function isGhanaPhone(input: unknown): boolean {
  return nationalNine(input) !== null;
}

/** Returns `+233XXXXXXXXX`, or null when the input is not a Ghana mobile number. */
export function normalizeGhanaPhone(input: unknown): string | null {
  const nine = nationalNine(input);
  return nine ? `+233${nine}` : null;
}

/**
 * Last 9 digits of whatever was typed (digits only). Used to compare a typed
 * phone with a stored one regardless of format. Returns '' when there are
 * fewer than 9 digits, so an empty or short value never matches anything.
 */
export function phoneLast9(input: unknown): string {
  if (input === null || input === undefined) return '';
  const digits = String(input).replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}
