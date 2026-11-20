/**
 * Help centre articles. Keep every answer in line with how the shop really
 * works: groceries and convenience goods in and around Accra; payment online
 * only, by Mobile Money through Moolre or card through Paystack; delivery
 * methods and fees exactly as checkout computes them; updates by SMS and
 * WhatsApp (the site sends no email); problems reported within 24 hours of
 * delivery; no loyalty points, gift cards or referral programme.
 */

import {
  PHONE_PRIMARY_DISPLAY,
  PHONE_PRIMARY_TEL,
  WHATSAPP_URL,
  CONTACT_EMAIL,
} from '@/components/legal/business-facts';
import { shopperUrl } from '@/lib/site-urls';

export const STORE_PHONE = PHONE_PRIMARY_DISPLAY;
export const STORE_PHONE_TEL = PHONE_PRIMARY_TEL;
export const STORE_WHATSAPP = WHATSAPP_URL;
export const STORE_EMAIL = CONTACT_EMAIL;

export type HelpSection = {
  heading?: string;
  paragraphs?: string[];
  list?: string[];
};

export type HelpArticle = {
  id: string;
  category: HelpCategoryId;
  title: string;
  summary: string;
  sections: HelpSection[];
  links?: { href: string; label: string }[];
};

export type HelpCategoryId = 'ordering' | 'payment' | 'delivery' | 'tracking' | 'shopper' | 'returns' | 'account';

export const HELP_CATEGORIES: { id: HelpCategoryId; title: string; icon: string }[] = [
  { id: 'ordering', title: 'Ordering', icon: 'ri-shopping-bag-line' },
  { id: 'payment', title: 'Paying online', icon: 'ri-bank-card-line' },
  { id: 'delivery', title: 'Delivery and pickup', icon: 'ri-truck-line' },
  { id: 'tracking', title: 'Tracking an order', icon: 'ri-map-pin-line' },
  { id: 'shopper', title: 'Personal Shopper', icon: 'ri-shopping-basket-2-line' },
  { id: 'returns', title: 'Problems and refunds', icon: 'ri-arrow-left-right-line' },
  { id: 'account', title: 'Your account', icon: 'ri-user-line' },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'how-to-order',
    category: 'ordering',
    title: 'How do I place an order?',
    summary: 'Add items to your cart, choose a delivery method, then pay online.',
    sections: [
      {
        list: [
          'Find the item in the shop. If it comes in sizes or types, choose one.',
          'Tap "Add to Cart". Some items have a minimum order quantity, shown on the product.',
          'At checkout, enter your name, a Ghana phone number and your delivery details.',
          'Choose a delivery method. Checkout shows the fee for your location before you pay.',
          'Pay by Mobile Money or card. Once the payment is confirmed you get an order number.',
        ],
      },
      {
        paragraphs: [
          'We send order updates by SMS or WhatsApp to the phone number on the order, so please check it carefully.',
          'You do not need an account to order. With an account, the orders you place while signed in are listed under My Account.',
        ],
      },
    ],
    links: [{ href: '/shop', label: 'Start shopping' }],
  },
  {
    id: 'change-or-cancel',
    category: 'ordering',
    title: 'Can I change or cancel my order?',
    summary: 'Yes, until it has been dispatched. WhatsApp or call us.',
    sections: [
      {
        paragraphs: [
          `WhatsApp or call us on ${PHONE_PRIMARY_DISPLAY} with your order number. If the order has not been dispatched, we make the change at no cost.`,
          'If it is already on its way, you cover the delivery cost already incurred (and any return trip) before we can change or cancel it. Perishable items cannot be cancelled once dispatched.',
        ],
      },
    ],
    links: [{ href: '/faqs#can-i-modify-or-cancel-my-order', label: 'Read the FAQ' }],
  },
  {
    id: 'payment-methods',
    category: 'payment',
    title: 'How can I pay?',
    summary: 'Mobile Money through Moolre, or a debit or credit card through Paystack.',
    sections: [
      {
        list: [
          'Mobile Money: MTN, Telecel Cash or AirtelTigo, through Moolre.',
          'Card: Visa, Mastercard or Verve, through Paystack. You enter your card details on Paystack\'s page, not on ours.',
        ],
      },
      {
        paragraphs: ['You pay online at checkout. We do not take cash on delivery, bank transfers or instalments.'],
      },
    ],
  },
  {
    id: 'payment-did-not-go-through',
    category: 'payment',
    title: 'My payment did not go through',
    summary: 'Your order is kept: you can try again, with the same or the other payment method.',
    sections: [
      {
        paragraphs: [
          'If a payment fails or you close the payment page, your order stays open and unpaid. You can pay it again from the payment page you were returned to, or, if you were signed in, from My Account → Order History → Complete Payment.',
          'You can switch between Mobile Money and card when you try again. You are only charged once the payment is confirmed.',
          `If money left your wallet or card but the order still shows as unpaid, WhatsApp us on ${PHONE_PRIMARY_DISPLAY} with your order number before paying again.`,
        ],
      },
    ],
  },
  {
    id: 'delivery-methods',
    category: 'delivery',
    title: 'Which delivery methods are there, and what do they cost?',
    summary: 'Pickup, Free Delivery, Sole Express, Joint Express or Add to Personal Shopper. Checkout shows each fee.',
    sections: [
      {
        list: [
          'Pickup: no delivery fee. Collect your order from our pickup point after we tell you it is ready.',
          'Free Delivery: runs daily after we confirm your order. The more you buy, the further it is free; beyond that you pay only for the extra distance.',
          'Sole Express: delivery slots from 2 to 48 hours after confirmation. Needed for fresh and perishable items.',
          'Joint Express: like Sole Express, but you share the delivery (and the fee) with a neighbour. Your items stay private.',
          'Add to Personal Shopper: pay for this cart now and it comes with your Personal Shopper request, with no separate delivery fee.',
        ],
      },
      {
        paragraphs: [
          'Delivery fees are worked out from the distance between our hub and the location you set at checkout, and shown before you pay.',
        ],
      },
    ],
    links: [{ href: '/shipping', label: 'Delivery information' }],
  },
  {
    id: 'outside-accra',
    category: 'delivery',
    title: 'Do you deliver outside Greater Accra?',
    summary: 'Yes, through a transport station in Accra. The onward fare is extra.',
    sections: [
      {
        paragraphs: [
          'For Kumasi, Takoradi, Cape Coast and anywhere else outside Greater Accra, we deliver your order to a commercial transport station in Accra. The fee at checkout covers our hub to the station.',
          'The fare from the station to your town is paid to the transport company. We only deliver within Ghana.',
        ],
      },
    ],
  },
  {
    id: 'pickup',
    category: 'delivery',
    title: 'Where do I collect a Pickup order?',
    summary: 'From our pickup point in Accra, once we tell you the order is ready.',
    sections: [
      {
        paragraphs: [
          'Checkout names the pickup point when you choose Pickup, and the Contact and Delivery pages show it with a map link.',
          'Wait for our SMS or WhatsApp message saying the order is ready, then bring your order number.',
        ],
      },
    ],
    links: [{ href: '/contact', label: 'See the pickup point' }],
  },
  {
    id: 'track-order',
    category: 'tracking',
    title: 'How do I track my order?',
    summary: 'Use your order number with the phone or email used on the order.',
    sections: [
      {
        list: [
          'Open Order Tracking.',
          'Enter your order number and the phone number or email address you used at checkout.',
          'You see the order status and items. We also send updates by SMS or WhatsApp.',
        ],
      },
      {
        paragraphs: ['If you were signed in when you ordered, the order is also listed under My Account → Order History.'],
      },
    ],
    links: [{ href: '/order-tracking', label: 'Track an order' }],
  },
  {
    id: 'personal-shopper',
    category: 'shopper',
    title: 'What is Personal Shopper?',
    summary: 'Send us a shopping list and we buy the items at the market for you.',
    sections: [
      {
        list: [
          'Write your shopping list on the Personal Shopper site, with an estimated price for each item.',
          'The site adds our service markup and the delivery fee, and you pay that estimate when you submit the list.',
          'We buy the items at market price and deliver them.',
          'If the market price differs from your estimate, our team settles the difference with you on WhatsApp.',
        ],
      },
      {
        paragraphs: ['Track a request with its SR- number and the phone number on the request.'],
      },
    ],
    links: [{ href: shopperUrl('/'), label: 'Go to Personal Shopper' }],
  },
  {
    id: 'report-a-problem',
    category: 'returns',
    title: 'Something is wrong with my order',
    summary: 'Tell us within 24 hours of delivery, with photos.',
    sections: [
      {
        list: [
          'Use the returns form (order number plus the phone or email on the order), or WhatsApp us.',
          'Send clear photos of the item and its packaging on WhatsApp, quoting your order number or RET- reference.',
          'Keep the item and its packaging until we have agreed the next step with you.',
          'We contact you by phone, SMS or WhatsApp. There are no return labels.',
        ],
      },
      {
        heading: 'What we can help with',
        paragraphs: [
          'Wrong, damaged, expired or spoiled, or missing items, and items not as described. Opened cosmetics, intimate apparel, earrings and perishable goods cannot be returned for a change of mind.',
        ],
      },
    ],
    links: [{ href: '/returns', label: 'Report a problem' }],
  },
  {
    id: 'refunds',
    category: 'returns',
    title: 'How do refunds work?',
    summary: 'Agreed refunds go back to the Mobile Money number or card you paid with.',
    sections: [
      {
        paragraphs: [
          'Once we agree a refund with you, we send it back to the payment method you used and tell you by SMS or WhatsApp. How long it takes to show depends on your network or bank.',
          'If the item was wrong, damaged or faulty, we cover the cost of putting it right. For a change of mind, the delivery cost is yours.',
        ],
      },
    ],
  },
  {
    id: 'create-account',
    category: 'account',
    title: 'Do I need an account?',
    summary: 'No. An account lets you see your orders, keep addresses and use support tickets.',
    sections: [
      {
        paragraphs: [
          'Sign up with your name, email, Ghana phone number and a password of at least 8 characters. You are signed in straight away.',
          'Orders placed while signed in appear under My Account, where you can also open a printable receipt, reorder, and keep an address book.',
        ],
      },
    ],
    links: [{ href: '/auth/signup', label: 'Create an account' }],
  },
  {
    id: 'forgot-password',
    category: 'account',
    title: 'I forgot my password',
    summary: 'WhatsApp or call us: we cannot send reset emails.',
    sections: [
      {
        paragraphs: [
          `WhatsApp or call us on ${PHONE_PRIMARY_DISPLAY} with the email address you sign in with. We check the account is yours and help you back in.`,
          'Once you are signed in, change your password under My Account → Profile. You need your current password to set a new one.',
        ],
      },
    ],
    links: [{ href: '/auth/forgot-password', label: 'Password help' }],
  },
  {
    id: 'delete-account',
    category: 'account',
    title: 'Can I download my data or delete my account?',
    summary: 'Yes, from My Account → Security → Privacy & data.',
    sections: [
      {
        paragraphs: [
          'Privacy & data downloads your profile, addresses, orders and support tickets as a file.',
          'You can also send us a request to delete your account. It is filed as a support ticket; we contact you to confirm before anything is deleted, and keep records the law requires, such as paid orders.',
        ],
      },
    ],
    links: [{ href: '/account/privacy', label: 'Privacy & data' }],
  },
];

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}
