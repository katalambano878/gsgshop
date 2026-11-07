/**
 * GSG Convenience Goods — delivery fee formulas.
 *
 * All numbers here are DEFAULTS. The live values (rate per km, multipliers,
 * purchase percentages, promo discount, hub point) are editable in
 * Admin → Delivery Pricing and stored in `site_settings.delivery_pricing`;
 * pass them in as `config` to price with the current settings.
 *
 * Sole Express:
 *   (rate × km × soleMultiplier) + (expressPct% of purchase) − discount
 *
 * Joint Express (shared — fee is split in half):
 *   [(rate × km × jointMultiplier) + (expressPct% of purchase)] ÷ 2 − discount
 *
 * Free Delivery (daily):
 *   (rate × km × freeMultiplier) − (freePct% of purchase)  (floored at GH₵0)
 *
 * Pickup / Personal Shopper handling: GH₵0 on this platform.
 */

export type DeliveryMethodId =
  | 'sole-express'
  | 'joint-express'
  | 'free-delivery'
  | 'pickup'
  | 'personal-shopper'
  | string;

export type DeliveryPricingConfig = {
  /** GH₵ per km base rate. */
  ratePerKm: number;
  soleMultiplier: number;
  jointMultiplier: number;
  freeMultiplier: number;
  /** Fraction (0.015 = 1.5%) of purchase added on express methods. */
  expressPurchasePct: number;
  /** Fraction (0.01 = 1%) of purchase offset on free delivery. */
  freePurchasePct: number;
  /** Standing promo discount (GH₵) applied to express methods. */
  promoDiscount: number;
};

export const DEFAULT_DELIVERY_PRICING: DeliveryPricingConfig = {
  ratePerKm: 0.5,
  soleMultiplier: 5,
  jointMultiplier: 7,
  freeMultiplier: 3,
  expressPurchasePct: 0.015,
  freePurchasePct: 0.01,
  promoDiscount: 0,
};

// Legacy constant exports (still referenced by older UI copy)
export const DELIVERY_RATE_PER_KM = DEFAULT_DELIVERY_PRICING.ratePerKm;
export const SOLE_EXPRESS_MULTIPLIER = DEFAULT_DELIVERY_PRICING.soleMultiplier;
export const JOINT_EXPRESS_MULTIPLIER = DEFAULT_DELIVERY_PRICING.jointMultiplier;
export const FREE_DELIVERY_MULTIPLIER = DEFAULT_DELIVERY_PRICING.freeMultiplier;
export const EXPRESS_PURCHASE_PCT = DEFAULT_DELIVERY_PRICING.expressPurchasePct;
export const FREE_DELIVERY_PURCHASE_PCT = DEFAULT_DELIVERY_PRICING.freePurchasePct;

export type DeliveryBreakdown = {
  method: DeliveryMethodId;
  km: number;
  purchaseTotal: number;
  distanceComponent: number;
  purchaseComponent: number;
  rawTotal: number;
  discount: number;
  /** Final fee charged (never negative). */
  fee: number;
  /** Human-readable formula used. */
  formulaLabel: string;
  /** Line-by-line explanation for UI. */
  lines: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Coerce a partial/unknown settings object into a safe full config. */
export function normalizeDeliveryPricing(raw: unknown): DeliveryPricingConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (key: keyof DeliveryPricingConfig): number => {
    const v = Number(src[key]);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DELIVERY_PRICING[key];
  };
  return {
    ratePerKm: num('ratePerKm'),
    soleMultiplier: num('soleMultiplier'),
    jointMultiplier: num('jointMultiplier'),
    freeMultiplier: num('freeMultiplier'),
    expressPurchasePct: Math.min(num('expressPurchasePct'), 0.5),
    freePurchasePct: Math.min(num('freePurchasePct'), 0.5),
    promoDiscount: num('promoDiscount'),
  };
}

export function methodNeedsDistance(method: DeliveryMethodId): boolean {
  return method === 'sole-express' || method === 'joint-express' || method === 'free-delivery';
}

export function calculateDeliveryFee(params: {
  method: DeliveryMethodId;
  km: number;
  purchaseTotal: number;
  /** Optional extra discount in GHS (coupons) on top of any promo discount. */
  discount?: number;
  /** Live pricing config; defaults keep historic behaviour. */
  config?: Partial<DeliveryPricingConfig>;
}): DeliveryBreakdown {
  const method = params.method;
  const km = Math.max(0, Number(params.km) || 0);
  const purchaseTotal = Math.max(0, Number(params.purchaseTotal) || 0);
  const cfg = { ...DEFAULT_DELIVERY_PRICING, ...(params.config || {}) };
  const discount = Math.max(0, Number(params.discount) || 0) + Math.max(0, cfg.promoDiscount);

  const rate = cfg.ratePerKm;
  const expressPctLabel = `${(cfg.expressPurchasePct * 100).toFixed(1).replace(/\.0$/, '')}%`;
  const freePctLabel = `${(cfg.freePurchasePct * 100).toFixed(1).replace(/\.0$/, '')}%`;

  if (method === 'pickup' || method === 'personal-shopper') {
    return {
      method,
      km,
      purchaseTotal,
      distanceComponent: 0,
      purchaseComponent: 0,
      rawTotal: 0,
      discount: 0,
      fee: 0,
      formulaLabel: method === 'pickup' ? 'Pickup — no delivery fee' : 'Personal Shopper — priced separately',
      lines: ['No delivery fee on this option.'],
    };
  }

  if (method === 'sole-express') {
    const distanceComponent = rate * km * cfg.soleMultiplier;
    const purchaseComponent = cfg.expressPurchasePct * purchaseTotal;
    const rawTotal = distanceComponent + purchaseComponent;
    const fee = round2(Math.max(0, rawTotal - discount));
    return {
      method,
      km,
      purchaseTotal,
      distanceComponent: round2(distanceComponent),
      purchaseComponent: round2(purchaseComponent),
      rawTotal: round2(rawTotal),
      discount: round2(discount),
      fee,
      formulaLabel: `GH₵${rate.toFixed(2)} × km × ${cfg.soleMultiplier} + ${expressPctLabel} of purchase − discount`,
      lines: [
        `Distance: GH₵${rate.toFixed(2)} × ${km} km × ${cfg.soleMultiplier} = GH₵${round2(distanceComponent).toFixed(2)}`,
        `Purchase share: ${expressPctLabel} of GH₵${purchaseTotal.toFixed(2)} = GH₵${round2(purchaseComponent).toFixed(2)}`,
        ...(discount > 0 ? [`Discount: − GH₵${round2(discount).toFixed(2)}`] : []),
        `Your Sole Express fee: GH₵${fee.toFixed(2)}`,
      ],
    };
  }

  if (method === 'joint-express') {
    const distanceComponent = rate * km * cfg.jointMultiplier;
    const purchaseComponent = cfg.expressPurchasePct * purchaseTotal;
    const rawTotal = (distanceComponent + purchaseComponent) / 2;
    const fee = round2(Math.max(0, rawTotal - discount));
    return {
      method,
      km,
      purchaseTotal,
      distanceComponent: round2(distanceComponent),
      purchaseComponent: round2(purchaseComponent),
      rawTotal: round2(rawTotal),
      discount: round2(discount),
      fee,
      formulaLabel: `(GH₵${rate.toFixed(2)} × km × ${cfg.jointMultiplier} + ${expressPctLabel} of purchase) ÷ 2 − discount`,
      lines: [
        `Distance: GH₵${rate.toFixed(2)} × ${km} km × ${cfg.jointMultiplier} = GH₵${round2(distanceComponent).toFixed(2)}`,
        `Purchase share: ${expressPctLabel} of GH₵${purchaseTotal.toFixed(2)} = GH₵${round2(purchaseComponent).toFixed(2)}`,
        `Shared (÷ 2): GH₵${round2(distanceComponent + purchaseComponent).toFixed(2)} ÷ 2 = GH₵${round2(rawTotal).toFixed(2)}`,
        ...(discount > 0 ? [`Discount: − GH₵${round2(discount).toFixed(2)}`] : []),
        `Your Joint Express share: GH₵${fee.toFixed(2)}`,
      ],
    };
  }

  if (method === 'free-delivery') {
    const distanceComponent = rate * km * cfg.freeMultiplier;
    const purchaseComponent = cfg.freePurchasePct * purchaseTotal;
    const rawTotal = distanceComponent - purchaseComponent;
    const fee = round2(Math.max(0, rawTotal));
    return {
      method,
      km,
      purchaseTotal,
      distanceComponent: round2(distanceComponent),
      purchaseComponent: round2(purchaseComponent),
      rawTotal: round2(rawTotal),
      discount: 0,
      fee,
      formulaLabel: `GH₵${rate.toFixed(2)} × km × ${cfg.freeMultiplier} − ${freePctLabel} of purchase`,
      lines: [
        `Distance: GH₵${rate.toFixed(2)} × ${km} km × ${cfg.freeMultiplier} = GH₵${round2(distanceComponent).toFixed(2)}`,
        `Purchase offset: ${freePctLabel} of GH₵${purchaseTotal.toFixed(2)} = − GH₵${round2(purchaseComponent).toFixed(2)}`,
        fee === 0
          ? 'Your Free Delivery fee: GH₵0.00 (fully offset)'
          : `Your Free Delivery fee: GH₵${fee.toFixed(2)}`,
      ],
    };
  }

  // Unknown method — don't invent a fee
  return {
    method,
    km,
    purchaseTotal,
    distanceComponent: 0,
    purchaseComponent: 0,
    rawTotal: 0,
    discount: 0,
    fee: 0,
    formulaLabel: 'Quoted at confirmation',
    lines: ['Fee will be confirmed with you before dispatch.'],
  };
}

/** Published formula copy for shipping page / FAQs. */
export const DELIVERY_FORMULA_COPY = [
  {
    id: 'sole-express' as const,
    name: 'Sole Express Delivery',
    schedule: 'Daily · 2hr–48hr windows',
    formula: 'GH₵0.50 × km × 5 + 1.5% of total purchase − discount',
    note: 'Required for fresh produce, bakery, meat, frozen, seafood, fish and poultry.',
  },
  {
    id: 'joint-express' as const,
    name: 'Joint Express Delivery',
    schedule: 'Daily · shared with a neighbour',
    formula: '(GH₵0.50 × km × 7 + 1.5% of total purchase) ÷ 2 − discount',
    note: 'You and a neighbour split the fee. Items stay private to each of you.',
  },
  {
    id: 'free-delivery' as const,
    name: 'Free Delivery',
    schedule: 'Daily after confirmation',
    formula: 'GH₵0.50 × km × 3 − 1% of total purchase',
    note: 'Distance and your order total set the fee: the more you buy, the further you get it FREE. If you live further than your free km, you only pay for the extra distance.',
  },
  {
    id: 'pickup' as const,
    name: 'Pickup',
    schedule: 'Daily after confirmation',
    formula: 'GH₵0 — no delivery fee',
    note: 'Pickup location is shown at the confirmation stage. Collect your items at your convenience.',
  },
];
