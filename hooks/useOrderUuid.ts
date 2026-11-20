/**
 * Remembers, on this device only, the row id of orders placed here, so the
 * pay page can prove the order is ours (`orderUuid`) when the customer comes
 * back from a gateway to /pay/<order number>. Nothing personal is stored.
 */

const KEY = 'gsg_order_ids';
const MAX = 20;

type Saved = Record<string, { id: string; at: number }>;

function readAll(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

export function saveOrderUuid(orderNumber: string, orderUuid: string): void {
  if (!orderNumber || !orderUuid) return;
  try {
    const all = readAll();
    all[orderNumber] = { id: orderUuid, at: Date.now() };
    const trimmed = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* storage unavailable: the pay page falls back to asking for the phone */
  }
}

export function readOrderUuid(orderNumber: string): string | null {
  if (!orderNumber) return null;
  return readAll()[orderNumber]?.id ?? null;
}
