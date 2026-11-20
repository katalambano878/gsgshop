// FAQ answers for the shop (/faqs), the Personal Shopper site (/shopper/faqs),
// the FAQPage structured data and the WhatsApp assistant (/api/brain/knowledge).
// Keep every answer true to how the site works: payments by Mobile Money
// (Moolre) or card (Paystack); confirmations and updates by SMS/WhatsApp (the
// site sends no email); problems reported within 24 hours of delivery; no
// loyalty points, referral programme, gift cards, saved cards or social login.

export const FAQ_CATEGORIES = [
  { id: 'all', name: 'All Questions', icon: 'ri-question-line' },
  { id: 'orders', name: 'Orders', icon: 'ri-shopping-bag-line' },
  { id: 'shipping', name: 'Shipping', icon: 'ri-truck-line' },
  { id: 'returns', name: 'Returns', icon: 'ri-arrow-go-back-line' },
  { id: 'payment', name: 'Payment', icon: 'ri-bank-card-line' },
  { id: 'account', name: 'Account', icon: 'ri-user-line' },
] as const;

export const STORE_FAQS = [
  {
    category: 'orders',
    question: 'How do I place an order?',
    answer:
      'Add items to your cart, go to checkout, enter your name, phone number and delivery details, choose a delivery method and pay by Mobile Money or card. Once your payment is confirmed you get an order number, and we send updates by SMS or WhatsApp to the phone number on the order.',
  },
  {
    category: 'orders',
    question: 'Can I modify or cancel my order?',
    answer:
      "Yes, as long as it hasn't been dispatched yet. WhatsApp or call us on +233 24 603 3792 or +233 57 903 3792 and we'll make the change at no cost. If your order is already on its way, you'll need to cover the delivery cost already incurred (and any return-trip cost) before we can cancel or modify. Perishable items can't be cancelled once dispatched.",
  },
  {
    category: 'orders',
    question: 'How do I track my order?',
    answer:
      'Open the Order Tracking page and enter your order number with the phone number or email address used on the order. If you have an account, your orders are also listed under My Account. We send updates by SMS or WhatsApp.',
  },
  {
    category: 'orders',
    question: 'What if I receive the wrong item?',
    answer:
      "We're sorry when that happens. Tell us within 24 hours of delivery, using the returns form on the site or on WhatsApp (+233 24 603 3792), and send photos of what you received. We'll agree the fix with you: the right item or a refund.",
  },
  {
    category: 'shipping',
    question: 'What are your delivery times?',
    answer:
      'It depends on the delivery method you pick at checkout. Sole Express and Joint Express run daily with 2-hour to 48-hour slots after we confirm your order; fresh and perishable items must use one of these. Free Delivery runs daily after confirmation. Pickup is free: collect your order from our pickup point (named at checkout) once we tell you it is ready. Add to Personal Shopper sends your goods with your Personal Shopper request.',
  },
  {
    category: 'shipping',
    question: 'How much does shipping cost?',
    answer:
      'Checkout works out the fee from the distance between our hub and your delivery location, and shows it before you pay. Search your area or landmark at checkout to set your location. Pickup and Add to Personal Shopper have no delivery fee. Sole Express, Joint Express and Free Delivery each show their amount once your location is set. With Free Delivery, the more you buy, the further it is free; beyond that you only pay for the extra distance. Joint Express splits the fee with a neighbour.',
  },
  {
    category: 'shipping',
    question: 'Do you deliver outside Greater Accra?',
    answer:
      'Yes, through a transport station. For Kumasi, Takoradi, Cape Coast and anywhere else outside Greater Accra, we deliver your order to a commercial transport station in Accra using the delivery method you pick at checkout, and the fee shown covers our hub to the station. The fare from the station to your town is extra and is paid to the transport company.',
  },
  {
    category: 'shipping',
    question: 'Do you ship outside Ghana?',
    answer:
      'No. We only deliver within Ghana.',
  },
  {
    category: 'shipping',
    question: 'What if nobody is home for delivery?',
    answer:
      "We always reach out and confirm collection arrangements with you before your order is dispatched, so this rarely happens. If the agreed handover still falls through on the day, we'll reschedule a fresh delivery with you. The rebooked delivery fee is paid by the customer, and applies to non-perishable items only. Perishables (fresh produce, frozen, etc.) cannot be rebooked once dispatched and are non-refundable for a missed handover.",
  },
  {
    category: 'returns',
    question: 'What is your return policy?',
    answer:
      'Report a problem within 24 hours of delivery, using the returns form on the site or on WhatsApp, and send photos of the item and its packaging. Keep the item until we have agreed the next step with you. There are no return labels: we arrange any collection or replacement with you by phone or WhatsApp.',
  },
  {
    category: 'returns',
    question: 'Which items cannot be returned?',
    answer:
      'For hygiene reasons, we cannot accept returns on opened cosmetics, intimate apparel, earrings, or perishable goods, unless they arrived damaged, spoiled or wrong. Custom or personalised items are also non-returnable unless defective.',
  },
  {
    category: 'returns',
    question: 'Who pays for return shipping?',
    answer:
      "If the item was wrong, damaged or faulty, we cover the cost of putting it right. For change-of-mind returns, the customer pays the delivery cost; the amount depends on the delivery method used (Sole Express, Joint Express, Free Delivery, or pickup at our location).",
  },
  {
    category: 'returns',
    question: 'Can I exchange an item instead of returning it?',
    answer:
      "Yes. Say so in the returns form or on WhatsApp and we'll agree the swap with you. For a change of mind (a different size, colour or brand), the customer pays the delivery cost of the swap, which depends on the delivery method you pick. If the item was faulty or we sent the wrong one, the swap is on us.",
  },
  {
    category: 'payment',
    question: 'What payment methods do you accept?',
    answer:
      'Mobile Money (MTN, Telecel Cash and AirtelTigo) through Moolre, and debit or credit cards (Visa, Mastercard, Verve) through Paystack. You pay online at checkout. We do not take cash on delivery, bank transfers or instalments.',
  },
  {
    category: 'payment',
    question: 'Is it safe to pay with my card on your site?',
    answer:
      'Yes. Card payments are handled on Paystack\'s secure payment page and Mobile Money payments by Moolre. Your card details are entered with Paystack, not on our site, and we do not store them.',
  },
  {
    category: 'payment',
    question: 'When will my payment be charged?',
    answer:
      "Card and Mobile Money payments are taken when you pay at checkout. If an item turns out to be unavailable after you have paid, we'll contact you to offer a replacement or refund it.",
  },
  {
    category: 'payment',
    question: 'How do refunds work?',
    answer:
      'Once we agree a refund with you, we send it back to the Mobile Money number or card you paid with, and let you know by SMS or WhatsApp. How long it takes to show depends on your network or bank.',
  },
  {
    category: 'account',
    question: 'Do I need an account to place an order?',
    answer:
      'No, you can check out as a guest. With an account you can see the orders you placed while signed in, keep an address book and use support tickets.',
  },
  {
    category: 'account',
    question: 'How do I reset my password?',
    answer:
      "We can't send reset emails. WhatsApp or call us on +233 24 603 3792 with the email address you sign in with, and our team will help you back into your account. Once you are signed in you can change your password under My Account.",
  },
  {
    category: 'account',
    question: 'Can I save more than one delivery address?',
    answer:
      'Yes. Under My Account, the Addresses tab lets you keep several addresses (home, work and so on) and mark one as your default, so you have them to hand when you check out.',
  },
  {
    category: 'account',
    question: 'How do I update my account information?',
    answer:
      'Sign in and open My Account. You can change your name and phone number in Profile, your password (you need your current one), and your saved addresses. Your sign-in email cannot be changed on the site; WhatsApp us if you need it changed.',
  },
] as const;

// Personal Shopper FAQs (shopper.gsgbrands.com.gh/faqs). Shared with the
// WhatsApp assistant through /api/brain/knowledge so both say the same thing.
export const SHOPPER_FAQS: { q: string; a: string }[] = [
  {
    q: "How does the Personal Shopper service work?",
    a: "Create a shopping list on our website with the items you need and your estimated prices. The site adds our service markup and the delivery fee, and you pay that estimate up front, by Mobile Money (MTN, Telecel Cash, AirtelTigo) or card, when you submit the list. We then buy the items at market price and deliver them. If the market price differs from your estimate, our team settles the difference with you on WhatsApp."
  },
  {
    q: "What is the markup fee?",
    a: "A percentage of the item subtotal. The current rate is shown on the shopping list before you submit and pay."
  },
  {
    q: "How is the delivery fee calculated?",
    a: "From the distance to your delivery location and the delivery method you choose. The fee is shown on your list before you pay."
  },
  {
    q: "Are there any hidden fees?",
    a: "No. You pay the item estimate, our markup and the delivery fee, all shown before you pay. In rare cases a sourcing fee may apply for hard-to-find items, but we always ask for your approval first."
  },
  {
    q: "What if the actual market price is higher than my estimate?",
    a: "Our staff contact you on WhatsApp before buying. You can pay the difference, or drop the item."
  },
  {
    q: "What if the actual market price is lower than my estimate?",
    a: "Because you paid the estimate up front, the difference is refunded to the Mobile Money number or card you paid with, normally within 1 to 3 working days."
  },
  {
    q: "Can I specify where you buy my produce?",
    a: "Yes! When adding vegetables, fruits, or herbs to your list, you can specify if you prefer them from the Local Market, Imported, or from a Controlled/Certified Environment."
  },
  {
    q: "Do you buy prescribed medicine?",
    a: "Yes, we can source prescribed medicine with a valid prescription. WhatsApp us on +233 24 603 3792 before you submit the list so we can confirm what we need from you."
  },
  {
    q: "What happens if an item is out of stock?",
    a: "We contact you on WhatsApp to suggest a suitable substitute. If you do not want one, we remove the item and refund its cost to the Mobile Money number or card you paid with."
  },
  {
    q: "How do I pay?",
    a: "You pay the estimate up front, online, when you submit your list: Mobile Money (MTN, Telecel Cash, AirtelTigo) through Moolre, or a debit or credit card through Paystack. Any difference after market pricing is settled with our staff on WhatsApp."
  },
  {
    q: "Can I schedule my delivery?",
    a: "Yes, you can give your preferred delivery time when submitting your list. Submit your list well in advance so we can deliver on time."
  },
  {
    q: "How can I track my request?",
    a: "On our Track page, enter your request number (it starts with SR-) together with the phone number you used on the request."
  }
];
