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
      "Browse our products, add items to your cart, proceed to checkout, provide your delivery address, select payment method, and confirm your order. You'll receive an email confirmation with your order details and tracking number.",
  },
  {
    category: 'orders',
    question: 'Can I modify or cancel my order?',
    answer:
      "Yes — as long as it hasn't been dispatched yet. Contact us via WhatsApp at +233 20 959 7443 or email info@gsgbrands.com.gh and we'll make the change at no cost. If your order is already on its way, you'll need to cover the delivery cost already incurred (and any return-trip cost) before we can cancel or modify. Perishable items can't be cancelled once dispatched.",
  },
  {
    category: 'orders',
    question: 'How do I track my order?',
    answer:
      "After your order ships, you'll receive a tracking number via email and SMS. Visit our Order Tracking page and enter your order number and email address to see real-time updates on your delivery status.",
  },
  {
    category: 'orders',
    question: 'What if I receive the wrong item?',
    answer:
      "We sincerely apologise if you receive the wrong item. Contact us within 48 hours with photos of the item received. We'll arrange for the correct item to be sent immediately and collect the wrong item at no cost to you.",
  },
  {
    category: 'shipping',
    question: 'What are your delivery times?',
    answer:
      'It depends on the delivery choice you pick at checkout. Sole Express and Joint Express run daily with 2hr, 6hr, 12hr, 24hr or 48hr slots after order confirmation — fresh and perishable items must use one of these. Free Delivery runs on Tuesdays and Fridays only, and your order must be confirmed before noon the preceding day. Pickup is ready within 72 hours of confirmation (excluding Sundays), and you collect at the location shared in your confirmation. Personal Shopper requests are scheduled separately once we confirm market prices with you.',
  },
  {
    category: 'shipping',
    question: 'How much does shipping cost?',
    answer:
      'Your delivery total is calculated from your delivery location and shown clearly at checkout before you pay. At checkout, search your area or landmark — we work out the distance for you. Pickup has no delivery fee. Sole Express, Joint Express, and Free Delivery (Tue/Fri) each show their final amount once your location is set.',
  },
  {
    category: 'shipping',
    question: 'Do you ship outside Ghana?',
    answer:
      "Currently, we only ship within Ghana. We're working on expanding to neighbouring West African countries. Sign up for our newsletter to be notified when international shipping becomes available.",
  },
  {
    category: 'shipping',
    question: 'What if nobody is home for delivery?',
    answer:
      "We always reach out and confirm collection arrangements with you before your order is dispatched, so this rarely happens. If the agreed handover still falls through on the day, we'll reschedule a fresh delivery with you — the rebooked delivery fee is paid by the customer, and applies to non-perishable items only. Perishables (fresh produce, frozen, etc.) cannot be rebooked once dispatched and are non-refundable for missed handover.",
  },
  {
    category: 'returns',
    question: 'What is your return policy?',
    answer:
      'We offer a 14-day return policy for unused items in original packaging. Simply initiate a return from your account, print the return label, and ship it back. Refunds are processed within 5-7 business days after we receive the item.',
  },
  {
    category: 'returns',
    question: 'Which items cannot be returned?',
    answer:
      'For hygiene reasons, we cannot accept returns on opened cosmetics, intimate apparel, earrings, or perishable goods. Custom or personalised items are also non-returnable unless defective.',
  },
  {
    category: 'returns',
    question: 'Who pays for return shipping?',
    answer:
      'If you\'re returning due to a defect or our error, we cover return shipping in full. For change-of-mind returns, the customer pays return shipping — the cost depends on the delivery option you choose to send the item back (Sole Express, Joint Express, Free Delivery on Tue/Fri, or pickup at our location).',
  },
  {
    category: 'returns',
    question: 'Can I exchange an item instead of returning it?',
    answer:
      'Yes — select "Exchange" when initiating your return and we\'ll send the replacement as soon as we receive your original item. Exchange shipping is paid by the customer because the swap is driven by your own change of mind (wrong size, colour, etc.). The exact cost depends on which delivery option you pick for the swap (Sole Express, Joint Express, Free Delivery on Tue/Fri, or pickup). If the item was defective or we shipped you the wrong one, exchange shipping is on us.',
  },
  {
    category: 'payment',
    question: 'What payment methods do you accept?',
    answer:
      'We accept MTN Mobile Money, Vodafone Cash, AirtelTigo Money, and Visa/Mastercard credit and debit cards via our secure Moolre payment gateway. All transactions are encrypted and processed securely.',
  },
  {
    category: 'payment',
    question: 'Is it safe to use my credit card on your site?',
    answer:
      'Absolutely. We use industry-standard SSL encryption and partner with Moolre for secure payment processing. We never store your full card details on our servers. All transactions are PCI-DSS compliant.',
  },
  {
    category: 'payment',
    question: 'When will my payment be charged?',
    answer:
      "Card and mobile money payments are charged immediately when you pay. If an item turns out to be out of stock, we'll refund you within 24 hours.",
  },
  {
    category: 'payment',
    question: 'How do refunds work?',
    answer:
      "Refunds are processed to your original payment method within 5-7 business days after we receive and inspect your return. For mobile money refunds, ensure you provide correct details. You'll receive confirmation via email.",
  },
  {
    category: 'account',
    question: 'Do I need an account to place an order?',
    answer:
      'No, you can checkout as a guest. However, creating an account lets you track orders, save addresses, view purchase history, manage your wishlist, and receive exclusive offers. It only takes 30 seconds to sign up.',
  },
  {
    category: 'account',
    question: 'How do I reset my password?',
    answer:
      "Click \"Forgot Password\" on the login page, enter your email address, and we'll send you a reset link. The link is valid for 1 hour. If you don't receive it, check your spam folder or contact support.",
  },
  {
    category: 'account',
    question: 'Can I have multiple delivery addresses?',
    answer:
      'Yes! You can save multiple delivery addresses in your account. During checkout, simply select the address you want to use or add a new one. This is perfect for sending gifts or alternating between work and home.',
  },
  {
    category: 'account',
    question: 'How do I update my account information?',
    answer:
      "Log in to your account and go to \"Account Settings\". You can update your name, email, phone number, password, and saved addresses. Changes are saved instantly and you'll receive a confirmation email.",
  },
  {
    category: 'account',
    question: 'What are loyalty points and how do they work?',
    answer:
      'Earn 1 point for every GHS 10 spent. 100 points = GHS 10 discount on your next purchase. Points are automatically added to your account after each order. Check your points balance in your account dashboard.',
  },
] as const;

// Personal Shopper FAQs (shopper.gsgbrands.com.gh/faqs). Shared with the
// WhatsApp assistant through /api/brain/knowledge so both say the same thing.
export const SHOPPER_FAQS: { q: string; a: string }[] = [
  {
    q: "How does the Personal Shopper service work?",
    a: "Simply create a shopping list on our website with the items you need and your estimated prices. We will review it, source the items at market price, and deliver them to your door. You pay a 15% or less Markup on the subtotal."
  },
  {
    q: "What is the markup fee?",
    a: "We charge a 15% or less Markup on the total cost of the items we purchase for you."
  },
  {
    q: "How is the delivery fee calculated?",
    a: "The delivery fee is calculated based on the distance from the market/store to your delivery address."
  },
  {
    q: "Are there any hidden fees?",
    a: "No. You pay the exact market price for the goods, plus our 15% or less Markup, and the delivery fee. In rare cases, a sourcing fee may apply for hard-to-find items, but we will always ask for your approval first."
  },
  {
    q: "What if the actual market price is higher than my estimate?",
    a: "If the actual price is significantly higher, we will contact you for approval before purchasing. If it's a minor difference, we may proceed and request a top-up payment."
  },
  {
    q: "What if the actual market price is lower than my estimate?",
    a: "If you have prepaid based on an estimate and the actual cost is lower, we will refund the difference or credit it to your account for future use."
  },
  {
    q: "Can I specify where you buy my produce?",
    a: "Yes! When adding vegetables, fruits, or herbs to your list, you can specify if you prefer them from the Local Market, Imported, or from a Controlled/Certified Environment."
  },
  {
    q: "Do you buy prescribed medicine?",
    a: "Yes, we can source prescribed medicine. You will need to provide a clear picture or copy of the valid prescription."
  },
  {
    q: "What happens if an item is out of stock?",
    a: "If an item is out of stock, we will contact you to suggest suitable substitutions. If you do not want a substitute, we will remove the item from your list and adjust the total."
  },
  {
    q: "How do I pay?",
    a: "Once your list is reviewed and prices are confirmed, we will send you a payment link. You can pay securely online using Mobile Money or a card."
  },
  {
    q: "Can I schedule my delivery?",
    a: "Yes, you can specify your preferred delivery time when submitting your list. We advise submitting your list well in advance to ensure timely delivery."
  },
  {
    q: "How can I track my request?",
    a: "You can track the status of your request on our Track page using your Request ID or the phone number you provided."
  }
];
