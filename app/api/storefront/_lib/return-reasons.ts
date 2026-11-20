/** Reasons the returns form offers; the server accepts exactly these. Safe to import in client pages. */
export const RETURN_REASONS = [
    'Wrong item received',
    'Damaged on arrival',
    'Expired or spoiled',
    'Missing items',
    'Not as described',
    'Other',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];
