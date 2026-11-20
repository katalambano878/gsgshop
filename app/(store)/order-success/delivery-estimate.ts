/**
 * Delivery estimate wording shared by the order success and tracking pages.
 *
 * Uses only what checkout promises for each method (lib/delivery-pricing.ts
 * and the checkout copy): Express in 2hr–48hr slots after payment is
 * confirmed; Free Delivery and Pickup daily after confirmation. No invented
 * day counts. When the order is not paid yet the promise is phrased relative
 * to payment instead of a date.
 */

export type DeliveryEstimate = {
  heading: string;
  dateLabel: string;
  subLabel?: string;
};

type EstimateOrder = {
  shipping_method?: string | null;
  payment_status?: string | null;
  status?: string | null;
  created_at?: string | null;
  metadata?: { payment_verified_at?: string | null } | null;
};

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function computeDeliveryEstimate(order: EstimateOrder, opts: { hubLabel?: string | null } = {}): DeliveryEstimate {
  const method = order?.shipping_method || '';
  const status = order?.status || '';
  const isPaid = order?.payment_status === 'paid';
  const paidIso = order?.metadata?.payment_verified_at || null;
  const anchor = paidIso ? new Date(paidIso) : isPaid && order.created_at ? new Date(order.created_at) : null;

  if (status === 'cancelled' || status === 'refunded') {
    return { heading: 'Delivery', dateLabel: status === 'cancelled' ? 'Order cancelled' : 'Order refunded' };
  }
  if (status === 'delivered') {
    return { heading: 'Delivery', dateLabel: 'Delivered' };
  }

  if (method === 'sole-express' || method === 'joint-express') {
    if (anchor) {
      const latest = new Date(anchor.getTime() + 48 * 60 * 60 * 1000);
      return {
        heading: 'Estimated Delivery',
        dateLabel: `By ${fmtDate(latest)}`,
        subLabel: 'Express: a 2hr–48hr slot after payment was confirmed',
      };
    }
    return {
      heading: 'Estimated Delivery',
      dateLabel: 'Within 48 hours of payment',
      subLabel: 'Express: a 2hr–48hr slot after payment is confirmed',
    };
  }

  if (method === 'pickup') {
    return {
      heading: 'Pickup',
      dateLabel: isPaid ? 'Daily after confirmation' : 'After payment',
      subLabel: opts.hubLabel
        ? `Collect from ${opts.hubLabel}. We will message you when it is ready.`
        : 'We will message you by SMS/WhatsApp when it is ready to collect.',
    };
  }

  if (method === 'free-delivery') {
    return {
      heading: 'Delivery',
      dateLabel: isPaid ? 'Daily after confirmation' : 'After payment',
      subLabel: 'Free Delivery runs daily; we will message you before it leaves',
    };
  }

  if (method === 'personal-shopper') {
    return {
      heading: 'Delivery',
      dateLabel: 'With your Personal Shopper order',
      subLabel: 'Free delivery together with your Personal Shopper items',
    };
  }

  return {
    heading: 'Estimated Delivery',
    dateLabel: isPaid ? 'We will message you' : 'After payment',
    subLabel: 'Timing depends on the delivery option you picked',
  };
}
