'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type WhatsAppWidgetProps = {
  /** Phone number in international format, digits only (no +). */
  phone?: string;
  /** Name shown in the chat card header. */
  agentName?: string;
  /** Short status line under the agent name. */
  agentStatus?: string;
  /** The greeting bubble shown when the card opens. */
  greeting?: string;
  /** Prefilled message the customer sends when starting the chat. */
  prefilledMessage?: string;
};

const DEFAULT_PHONE = '233246033792';

// Routes where the widget should never show (admin, checkout, payment flows).
const HIDDEN_PREFIXES = [
  '/admin',
  '/checkout',
  '/pay',
  '/shopper/pay',
  '/auth',
  '/shopper/payment-complete',
];

export default function WhatsAppWidget({
  phone = DEFAULT_PHONE,
  agentName = 'GSG Support',
  agentStatus = 'Replies during opening hours',
  greeting = "Hi there! 👋\n\nWelcome to GSG. How can we help you today?",
  prefilledMessage = "Hi GSG! I'd like some help.",
}: WhatsAppWidgetProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isHidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isHidden || !mounted) return null;

  const cleanPhone = phone.replace(/[^\d]/g, '');
  const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(prefilledMessage)}`;

  return (
    <div
      className="fixed bottom-20 right-3 sm:right-4 lg:bottom-6 lg:right-6 z-[70] print:hidden"
      // Keep the wrapper from eating page clicks — only children that opt in receive events.
      style={{ pointerEvents: 'none' }}
    >
      {/* Chat card — absolutely above the button so a closed card never blocks taps */}
      <div
        className={`absolute bottom-[4.5rem] right-0 w-[min(calc(100vw-1.5rem),340px)] origin-bottom-right overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 transition-all duration-200 ${
          open
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none invisible translate-y-2 scale-95 opacity-0'
        }`}
        role="dialog"
        aria-label="Chat with us on WhatsApp"
        aria-hidden={!open}
      >
        <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3.5 text-white">
          <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
            <i className="ri-whatsapp-fill text-2xl text-white" aria-hidden />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#075E54] bg-green-400"
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{agentName}</p>
            <p className="truncate text-xs text-white/80">{agentStatus}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
          >
            <i className="ri-close-line text-xl" aria-hidden />
          </button>
        </div>

        <div className="bg-[#ECE5DD] px-4 py-5">
          <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-white px-3.5 py-2.5 shadow-sm">
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">
              {greeting}
            </p>
            <span className="mt-1 block text-right text-[10px] text-gray-400">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        <div className="bg-white p-3">
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3.5 font-semibold text-white shadow-md transition-all hover:bg-[#1FB855] hover:shadow-lg active:scale-[0.98]"
          >
            <i className="ri-whatsapp-fill text-xl" aria-hidden />
            Start Chat
          </a>
        </div>
      </div>

      {/* FAB — large hit target; ping must never steal clicks */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close WhatsApp chat' : 'Chat with us on WhatsApp'}
        aria-expanded={open}
        className="pointer-events-auto relative flex h-16 w-16 touch-manipulation items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_8px_24px_rgba(37,211,102,0.45)] transition-transform duration-150 hover:scale-105 hover:bg-[#1FB855] active:scale-95"
      >
        {!open && (
          <span
            className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-[#25D366]/60"
            aria-hidden
          />
        )}
        <i
          className={`relative z-10 text-[2rem] leading-none ${open ? 'ri-close-line' : 'ri-whatsapp-fill'}`}
          aria-hidden
        />
      </button>
    </div>
  );
}
