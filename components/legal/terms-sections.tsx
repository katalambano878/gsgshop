import React from 'react';
import type { LegalSection } from './LegalDoc';

/**
 * Source: https://www.gsgbrands.com.gh/terms (Effective 11 May 2026).
 * Keep this in sync with the umbrella site by replacing the JSX bodies below
 * — the only place these terms live in the gsgshop codebase.
 */
export const TERMS_INTRO: React.ReactNode = (
  <>
    The contract that governs how you use every GSG Brands service —
    Convenience Goods &amp; More, Personal Shopper, Sell-Safe Buy-Safe,
    StreetCuisine, Courier, GSG-AID, and the Affiliates programme. Plain
    Ghanaian English, but legally binding.
  </>
);

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'about',
    num: '01',
    title: 'About these terms',
    body: (
      <>
        <p>
          Welcome to GSG Brands. These General Terms and Conditions (the{' '}
          <strong>&ldquo;Terms&rdquo;</strong>) form a binding agreement between you
          (<strong>&ldquo;you&rdquo;</strong> or <strong>&ldquo;User&rdquo;</strong>) and GSG
          Brands (<strong>&ldquo;we&rdquo;</strong>, <strong>&ldquo;us&rdquo;</strong>, or{' '}
          <strong>&ldquo;our&rdquo;</strong>). They govern your access to and use of
          our websites, mobile interfaces, customer-service channels, and any of
          the services offered under the GSG Brands family (the{' '}
          <strong>&ldquo;Services&rdquo;</strong>) — including Convenience Goods
          &amp; More, Personal Shopper, Sell-Safe Buy-Safe, StreetCuisine,
          Courier, GSG-AID, and the GSG Affiliates programme.
        </p>
        <p>
          By creating an account, placing an order, joining the Affiliates
          programme, or otherwise using any of our Services, you confirm that
          you have read, understood, and agreed to be bound by these Terms,
          together with our Privacy Policy and Cookie Policy, each of which is
          incorporated by reference.
        </p>
        <p>If you do not agree to any part of these Terms, please do not use our Services.</p>
      </>
    ),
  },
  {
    id: 'who-we-are',
    num: '02',
    title: 'Who we are',
    body: (
      <>
        <p>
          GSG Brands is a Ghanaian service ecosystem with offices in Accra and
          operations across Ghana. You can reach us through any of the following
          channels:
        </p>
        <ul>
          <li>Email — <a href="mailto:info@gsgbrands.com.gh">info@gsgbrands.com.gh</a></li>
          <li>Phone — +233 (0) 246 033 792 / +233 (0) 579 033 792</li>
          <li>Website — <a href="https://gsgbrands.com.gh">https://gsgbrands.com.gh</a></li>
          <li>WhatsApp &amp; Telegram — @gsgbrandsgh</li>
        </ul>
        <p>
          References to <strong>&ldquo;GSG Brands&rdquo;</strong> in these Terms include
          our affiliated business units and subsidiaries operating under the GSG
          umbrella.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    num: '03',
    title: 'Eligibility & accounts',
    body: (
      <>
        <p>
          You must be at least 18 years of age, or the age of majority in your
          jurisdiction, to use the Services. Where a minor uses any Service,
          that use must occur under the supervision of a parent or legal
          guardian who agrees to be bound by these Terms on the minor&apos;s
          behalf.
        </p>
        <p>When you register an account you agree to:</p>
        <ul>
          <li>provide accurate, current, and complete information;</li>
          <li>keep your credentials confidential and notify us of unauthorised access;</li>
          <li>accept responsibility for all activity that occurs under your account.</li>
        </ul>
        <p>
          We may refuse, restrict, suspend, or terminate any account at our
          reasonable discretion where we have grounds to believe these Terms
          have been breached or that a Service is being used for unlawful or
          fraudulent purposes.
        </p>
      </>
    ),
  },
  {
    id: 'our-services',
    num: '04',
    title: 'Our services',
    body: (
      <>
        <p>The GSG ecosystem currently includes the following Services:</p>
        <ul>
          <li>
            <strong>Convenience Goods &amp; More</strong> — everyday essentials,
            groceries, household items, and personal-care products delivered to
            homes and offices.
          </li>
          <li>
            <strong>Personal Shopper</strong> — assisted sourcing from
            traditional and non-traditional markets in Ghana, including bulk and
            specialty buying.
          </li>
          <li>
            <strong>Sell-Safe Buy-Safe</strong> — a protection service that
            holds payment from a buyer until the seller delivers the agreed
            goods or service.
          </li>
          <li>
            <strong>StreetCuisine</strong> — discovery and delivery of authentic
            Ghanaian cuisine from vendors who meet our hygiene and quality
            standards.
          </li>
          <li>
            <strong>Courier</strong> — pickup, dispatch, and delivery for
            documents, parcels, errands, and business logistics.
          </li>
          <li>
            <strong>GSG-AID</strong> — community support and empowerment
            programmes carried out directly or with partners.
          </li>
          <li>
            <strong>Affiliates</strong> — a referral and partner programme for
            individuals and businesses that promote GSG services.
          </li>
        </ul>
        <p>
          Individual Services may carry additional service-specific terms.
          Where service-specific terms conflict with these General Terms, the
          service-specific terms apply.
        </p>
      </>
    ),
  },
  {
    id: 'orders-pricing-taxes',
    num: '05',
    title: 'Orders, pricing & taxes',
    body: (
      <>
        <p>
          Prices on our platforms are quoted in Ghana Cedis (GHS) and are
          inclusive of VAT and other applicable levies unless we clearly
          indicate otherwise. Delivery fees, courier charges, service fees, and
          any other applicable charges are shown to you before you confirm your
          order.
        </p>
        <p>
          We make every effort to keep listings accurate, but errors in
          description, image, availability, or pricing can occur. Where a clear
          error is identified before dispatch, we may correct, cancel, or refund
          the order.
        </p>
        <p>
          Acceptance of your order occurs when we send written confirmation by
          SMS, WhatsApp, or an on-screen confirmation after payment. Until then,
          we are not contractually bound to fulfil the order.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    num: '06',
    title: 'Payments',
    body: (
      <>
        <p>On our online shops we accept the following payment methods, paid online at checkout:</p>
        <ul>
          <li>mobile money (MTN MoMo, Telecel Cash and AirtelTigo Money) through our payment partner Moolre;</li>
          <li>debit and credit cards (Visa, Mastercard, Verve) through our payment partner Paystack.</li>
        </ul>
        <p>We do not accept cash on delivery, bank transfers or instalment payments for online orders.</p>
        <p>
          By providing payment information, you confirm that you are authorised
          to use that payment method and that any details you give are
          accurate. Mobile-money transaction references are an acceptable proof
          of payment; please retain them in case of dispute.
        </p>
        <p>
          Where a charge is reversed, charged back, or otherwise reclaimed by
          your payment provider for reasons unrelated to a failure on our side,
          we reserve the right to recover the amount, pause future orders, or
          terminate your account.
        </p>
      </>
    ),
  },
  {
    id: 'delivery-couriers',
    num: '07',
    title: 'Delivery & couriers',
    body: (
      <>
        <p>
          We deliver within Greater Accra. For other regions of Ghana, we
          deliver orders to a commercial transport station in Accra; the
          onward fare from the station is paid by you to the transport company.
          Delivery methods, fees and lead times for each Service are shown at
          checkout or confirmed by Customer Experience.
        </p>
        <p>
          Risk in goods passes to you on delivery to the address provided. Title
          to goods passes once full payment is received. If no one is available
          to receive a delivery, our courier may attempt re-delivery, leave the
          parcel with a neighbour or building manager (where you have instructed
          us to do so), or return it to our base. Failed-delivery surcharges
          may apply.
        </p>
        <p>Photo or signature confirmation may be required at the point of delivery.</p>
      </>
    ),
  },
  {
    id: 'escrow',
    num: '08',
    title: 'Sell-Safe Buy-Safe (escrow conditions)',
    body: (
      <>
        <p>
          Sell-Safe Buy-Safe is a protection service that holds payment from a
          buyer until the seller delivers the agreed goods or service. Both
          parties must agree to specific, written conditions — item
          description, price, delivery timeline, return rules — before funds
          are held.
        </p>
        <p>
          Funds are released to the seller once the buyer confirms receipt and
          inspection within the agreed timeframe, or after that timeframe has
          elapsed without a valid dispute being raised.
        </p>
        <p>
          Where a dispute is raised, GSG Brands acts as a neutral facilitator.
          We may request supporting documents, photos, or videos and may
          consult independent expertise. Our decision in a dispute is final
          between you and GSG, without prejudice to your other legal rights.
        </p>
        <p>
          Sell-Safe Buy-Safe is not insurance and does not guarantee against all
          losses, including those arising from misrepresentation outside the
          agreed terms, force majeure events, or claims raised after the agreed
          inspection window.
        </p>
      </>
    ),
  },
  {
    id: 'cancellations-returns',
    num: '09',
    title: 'Cancellations, returns & refunds',
    body: (
      <>
        <p>
          You may cancel an order before it is dispatched at no charge, unless
          the order is for perishable goods, custom-sourced items, or food
          prepared to order. After dispatch, cancellation will be subject to
          courier and re-stocking fees.
        </p>
        <p>
          We accept returns of goods that are damaged on arrival, materially
          different from the listing, or unsafe to use. Notification must be
          given within 24 hours of receipt, by WhatsApp, phone or the returns
          form on our website, with photos of the goods. Please keep the goods
          in their original condition until we have agreed the next step with
          you; we do not issue return labels.
        </p>
        <p>
          Refunds for cancelled or undeliverable items are returned to the
          original Mobile Money number or card, normally within 1 to 3 working
          days. Other agreed refunds are made through the original payment
          channel where feasible, or via mobile money where the original
          channel is unavailable.
        </p>
        <p>
          Food, perishables, and personal-care items that have been opened are
          non-returnable for hygiene reasons, except where the issue relates to
          quality or safety.
        </p>
      </>
    ),
  },
  {
    id: 'affiliates',
    num: '10',
    title: 'Affiliates programme',
    body: (
      <>
        <p>
          The GSG Affiliates programme rewards individuals and businesses for
          verifiable referrals that lead to successful transactions on our
          Services. Affiliate earnings are calculated according to the
          programme schedule communicated at the point of registration and may
          be updated from time to time with reasonable notice.
        </p>
        <p>
          We may withhold or claw back earnings tied to fraudulent referrals,
          self-referrals, or transactions later reversed by chargeback. Tax on
          affiliate earnings is the responsibility of the affiliate.
        </p>
      </>
    ),
  },
  {
    id: 'user-content',
    num: '11',
    title: 'User content & conduct',
    body: (
      <>
        <p>
          You may submit questions, reviews, photos, or other content through
          Ask GSG Brands, Customer Experience, and other input points (
          <strong>&ldquo;User Content&rdquo;</strong>). You retain ownership of your
          User Content but grant GSG Brands a worldwide, non-exclusive,
          royalty-free licence to use, reproduce, modify, and display that
          content in connection with operating, improving, and promoting the
          Services.
        </p>
        <p>You must not use the Services to:</p>
        <ul>
          <li>break the laws of Ghana or any applicable jurisdiction;</li>
          <li>infringe the rights of others, including intellectual-property rights;</li>
          <li>post defamatory, obscene, hateful, harassing, or violent content;</li>
          <li>misrepresent yourself or impersonate another person;</li>
          <li>attempt to access another user&apos;s account or our internal systems without authorisation;</li>
          <li>interfere with the integrity of the Services, including by automated scraping, stress testing, or uploading malicious code.</li>
        </ul>
        <p>
          We may remove User Content, suspend accounts, and report illegal
          activity to appropriate authorities where we reasonably believe doing
          so is necessary.
        </p>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    num: '12',
    title: 'Intellectual property',
    body: (
      <>
        <p>
          All trademarks, logos, designs, photographs, illustrations, copy,
          software code, and other materials displayed on our platforms are the
          property of GSG Brands, our affiliates, or our licensors, and are
          protected by Ghanaian and international intellectual-property laws.
        </p>
        <p>
          You are granted a personal, non-transferable, revocable licence to
          access and use the Services for their intended purposes. No other
          rights are granted by implication. Any unauthorised use, reproduction,
          or commercial exploitation is strictly prohibited.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    num: '13',
    title: 'Disclaimers & limitation of liability',
    body: (
      <>
        <p>
          Subject to applicable Ghanaian consumer-protection law, the Services
          are provided on an <strong>&ldquo;as is&rdquo;</strong> and{' '}
          <strong>&ldquo;as available&rdquo;</strong> basis. We do not warrant that the
          Services will be uninterrupted, error-free, or fit for any particular
          purpose beyond what is expressly stated in these Terms or
          service-specific terms.
        </p>
        <p>
          To the maximum extent permitted by law, GSG Brands, its directors,
          employees, agents, and affiliates will not be liable for any indirect,
          incidental, special, consequential, or exemplary damages — including
          lost profits, lost goodwill, or lost data — arising from your use of
          the Services.
        </p>
        <p>
          Our total aggregate liability to you in connection with any Service in
          any 12-month period will not exceed the greater of (a) the total
          amount you paid to us for that Service in that period, or (b) GHS
          1,000.
        </p>
        <p>
          Nothing in these Terms excludes or limits liability that cannot be
          excluded or limited under Ghanaian law (for example, liability for
          death or personal injury caused by negligence, or for fraud).
        </p>
      </>
    ),
  },
  {
    id: 'indemnity',
    num: '14',
    title: 'Indemnity',
    body: (
      <p>
        You agree to indemnify and hold GSG Brands and its affiliates harmless
        from any claims, losses, liabilities, damages, costs, and expenses
        (including reasonable legal fees) arising out of (a) your breach of
        these Terms; (b) your misuse of the Services; (c) your User Content;
        or (d) your violation of any law or third-party right.
      </p>
    ),
  },
  {
    id: 'suspension-termination',
    num: '15',
    title: 'Suspension & termination',
    body: (
      <>
        <p>
          We may suspend or terminate your access to the Services at any time,
          with or without notice, where we reasonably believe these Terms have
          been breached, where required by law, or to protect our team,
          partners, or other users.
        </p>
        <p>
          You may close your account at any time by contacting Customer
          Experience. Closing your account does not relieve you of obligations
          accrued before closure (for example, outstanding payments).
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    num: '16',
    title: 'Governing law & dispute resolution',
    body: (
      <>
        <p>
          These Terms, and any non-contractual obligations arising out of or in
          connection with them, are governed by the laws of the Republic of
          Ghana.
        </p>
        <p>
          Before commencing formal proceedings, you agree to first contact
          Customer Experience and to negotiate in good faith for at least 30
          days. Where a dispute remains unresolved, the parties submit to the
          exclusive jurisdiction of the competent courts in Accra, Ghana —
          without prejudice to mandatory consumer-protection rights that allow
          you to bring proceedings in your local court of residence.
        </p>
        <p>
          Where appropriate, the parties may agree to alternative dispute
          resolution (mediation or arbitration) under Ghanaian law.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    num: '17',
    title: 'Changes to these terms',
    body: (
      <p>
        We may revise these Terms from time to time. Where the changes are
        material, we will notify you through reasonable channels, such as SMS,
        WhatsApp, or a notice on our platforms, before they take effect. Continued use
        of the Services after the effective date confirms your acceptance of
        the revised Terms.
      </p>
    ),
  },
  {
    id: 'contact',
    num: '18',
    title: 'Contact',
    body: (
      <>
        <p>For any question, concern, or formal notice under these Terms:</p>
        <ul>
          <li>Email — <a href="mailto:info@gsgbrands.com.gh">info@gsgbrands.com.gh</a></li>
          <li>Phone — +233 (0) 246 033 792 / +233 (0) 579 033 792</li>
          <li>
            Customer Experience —{' '}
            <a href="https://www.gsgbrands.com.gh/customer-experience" target="_blank" rel="noreferrer">
              gsgbrands.com.gh/customer-experience
            </a>
          </li>
          <li>Office hours — Mon–Fri 05:00–14:00 GMT, Saturdays and public holidays 05:00–09:00 GMT, with extended slots; see Customer Experience for current windows.</li>
        </ul>
      </>
    ),
  },
];
