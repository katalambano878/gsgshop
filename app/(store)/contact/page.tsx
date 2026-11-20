"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useCMS } from '@/context/CMSContext';
import PageHero from '@/components/PageHero';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { isGhanaPhone } from '@/lib/phone';
import PickupPoint from '@/components/legal/PickupPoint';
import {
  CONTACT_EMAIL,
  PHONE_PRIMARY_DISPLAY,
  PHONE_SECONDARY_DISPLAY,
  PHONE_SECONDARY_TEL,
  WHATSAPP_NUMBER,
  OPENING_HOURS,
  HOURS_SUMMARY,
} from '@/components/legal/business-facts';

const SUBJECTS = ['An order I placed', 'Delivery or pickup', 'Payment', 'A product', 'Personal Shopper', 'Something else'];

const inputCls =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-transparent text-sm outline-none';

export default function ContactPage() {
  usePageTitle('Contact Us');
  const { getSetting } = useCMS();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');
  const { getToken, verifying } = useRecaptcha();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus('idle');
    setErrorText('');

    const email = formData.email.trim();
    const phone = formData.phone.trim();
    if (!email && !phone) {
      setSubmitStatus('error');
      setErrorText('Please give a phone number or an email address so we can reply.');
      return;
    }
    if (phone && !isGhanaPhone(phone)) {
      setSubmitStatus('error');
      setErrorText('Please enter a Ghana mobile number, for example 024 603 3792.');
      return;
    }
    if (email && !/\S+@\S+\.\S+/.test(email)) {
      setSubmitStatus('error');
      setErrorText('Please enter a valid email address, or leave it empty.');
      return;
    }

    setIsSubmitting(true);
    // reCAPTCHA verification
    const isHuman = await getToken('contact');
    if (!isHuman) {
      setSubmitStatus('error');
      setErrorText('Security verification failed. Please try again.');
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/storefront/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          subject: formData.subject,
          message: formData.message.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitStatus('error');
        setErrorText(data.error || data.message || 'Your message could not be sent. Please try again, or WhatsApp us.');
        return;
      }
      setSubmitStatus('success');
      setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch {
      setSubmitStatus('error');
      setErrorText('Network error. Check your connection and try again, or WhatsApp us.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Contact details from CMS settings, with the shop's own details as defaults.
  const contactEmail = getSetting('contact_email') || CONTACT_EMAIL;
  const contactPhone = getSetting('contact_phone') || PHONE_PRIMARY_DISPLAY;
  const contactWhatsApp = getSetting('contact_whatsapp') || WHATSAPP_NUMBER;
  const waDigits = contactWhatsApp.replace(/[^0-9]/g, '');

  const contactMethods = [
    {
      icon: 'ri-whatsapp-line',
      title: 'WhatsApp',
      value: contactPhone,
      link: `https://wa.me/${waDigits}`,
      description: 'The quickest way to reach us'
    },
    {
      icon: 'ri-phone-line',
      title: 'Call Us',
      value: contactPhone,
      link: `tel:${contactPhone.replace(/[^\d+]/g, '')}`,
      description: HOURS_SUMMARY
    },
    {
      icon: 'ri-phone-line',
      title: 'Second line',
      value: PHONE_SECONDARY_DISPLAY,
      link: `tel:${PHONE_SECONDARY_TEL}`,
      description: HOURS_SUMMARY
    },
    {
      icon: 'ri-mail-line',
      title: 'Email',
      value: contactEmail,
      link: `mailto:${contactEmail}`,
      description: 'We reply by phone, SMS or WhatsApp where we can'
    }
  ];

  const faqs = [
    {
      question: 'How long does delivery take?',
      answer: 'It depends on the delivery method you choose at checkout: Pickup, Free Delivery, Sole Express or Joint Express. Checkout shows each fee for your address before you pay. Outside Greater Accra we drop your order at an Accra transport station and the onward fare is paid to the transport company.'
    },
    {
      question: 'Where do you deliver?',
      answer: 'In and around Accra. For other regions we send your order to an Accra transport station for onward travel; you pay the transport fare when you collect it.'
    },
    {
      question: 'What payment methods do you accept?',
      answer: 'Mobile Money (MTN, Telecel Cash and AirtelTigo) through Moolre, and debit or credit cards (Visa, Mastercard, Verve) through Paystack. We do not take cash on delivery or bank transfers.'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      <PageHero
        title="Get In Touch"
        subtitle="Questions about an order, delivery or our groceries and household goods? We're here to help from Accra."
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {contactMethods.map((method) => (
            <a
              key={method.title}
              href={method.link}
              target={method.link.startsWith('http') ? '_blank' : undefined}
              rel={method.link.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="bg-white border border-gray-200 p-6 rounded-2xl hover:shadow-lg hover:border-purple-200 transition-all cursor-pointer"
            >
              <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mb-4">
                <i className={`${method.icon} text-2xl text-gsg-purple`} aria-hidden="true"></i>
              </div>
              <h3 className="font-bold text-gray-900 mb-2">{method.title}</h3>
              <p className="text-gsg-purple font-medium mb-1 break-words">{method.value}</p>
              <p className="text-sm text-gray-500">{method.description}</p>
            </a>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Send Us a Message</h2>
            <p className="text-gray-600 mb-8">
              Leave a phone number or an email address and we will get back to you, usually by phone, SMS or WhatsApp.
              For a problem with an order, use the <Link href="/returns" className="text-gsg-purple font-semibold hover:underline">returns form</Link> within 24 hours of delivery.
            </p>

            <form id="contactForm" onSubmit={handleSubmit} className="space-y-6" noValidate>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  autoComplete="name"
                  maxLength={120}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    inputMode="tel"
                    autoComplete="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className={inputCls}
                    placeholder="024 XXX XXXX"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={inputCls}
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 -mt-3">Give at least one: a phone number or an email address.</p>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                  Subject *
                </label>
                <select
                  id="subject"
                  name="subject"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className={`${inputCls} bg-white`}
                >
                  <option value="">Choose a subject</option>
                  {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  Message *
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  minLength={10}
                  maxLength={2000}
                  aria-describedby="message-count"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className={`${inputCls} resize-none`}
                  placeholder="Tell us how we can help. Include your order number if it is about an order."
                ></textarea>
                <p id="message-count" className="text-xs text-gray-500 mt-1">{formData.message.length}/2000 characters</p>
              </div>

              {submitStatus === 'success' && (
                <div role="status" className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl">
                  <i className="ri-check-line mr-2" aria-hidden="true"></i>
                  Thank you, we have your message. We will reply during our opening hours.
                </div>
              )}

              {submitStatus === 'error' && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
                  <i className="ri-error-warning-line mr-2" aria-hidden="true"></i>
                  {errorText || 'Your message could not be sent. Please try again, or WhatsApp us.'}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || verifying || !formData.name.trim() || !formData.subject || formData.message.trim().length < 10}
                className="w-full bg-gsg-purple text-white py-4 rounded-xl font-medium hover:bg-gsg-purple-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
              >
                {isSubmitting || verifying ? (verifying ? 'Verifying...' : 'Sending...') : 'Send Message'}
              </button>
            </form>
          </div>

          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Quick Answers</h2>
            <p className="text-gray-600 mb-8">
              More in our <Link href="/faqs" className="text-gsg-purple font-semibold hover:underline">FAQs</Link>.
            </p>

            <div className="space-y-4 mb-12">
              {faqs.map((faq) => (
                <details key={faq.question} className="bg-gray-50 rounded-xl overflow-hidden">
                  <summary className="px-6 py-4 font-medium text-gray-900 cursor-pointer hover:bg-gray-100 transition-colors">
                    {faq.question}
                  </summary>
                  <div className="px-6 pb-4 text-gray-600 leading-relaxed">
                    {faq.answer}
                  </div>
                </details>
              ))}
            </div>

            <div className="bg-gradient-to-br from-gsg-purple to-gsg-purple-dark p-8 rounded-2xl text-white">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4">
                <i className="ri-customer-service-2-line text-2xl" aria-hidden="true"></i>
              </div>
              <h3 className="text-2xl font-bold mb-3">Need Immediate Help?</h3>
              <div className="text-purple-100 mb-6 leading-relaxed space-y-1">
                <p>Our team is available:</p>
                <ul>
                  {OPENING_HOURS.map((h) => (
                    <li key={h.days}>{h.days}: {h.hours}</li>
                  ))}
                </ul>
                <p>WhatsApp is the quickest way to reach us.</p>
              </div>
              <a
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-gsg-purple px-6 py-3 rounded-full font-medium hover:bg-purple-50 transition-colors whitespace-nowrap"
              >
                <i className="ri-whatsapp-line text-xl" aria-hidden="true"></i>
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Collecting an order</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              We sell online. If you choose Pickup at checkout, collect your order from our pickup point once we have told you it is ready.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-gray-600">
              <div className="flex items-center gap-2">
                <i className="ri-map-pin-2-line text-gsg-purple" aria-hidden="true"></i>
                <PickupPoint />
              </div>
              <div className="flex items-center gap-2">
                <i className="ri-time-line text-gsg-purple" aria-hidden="true"></i>
                <span>{HOURS_SUMMARY}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
