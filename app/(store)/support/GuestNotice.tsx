import Link from 'next/link';
import { whatsappLink } from '@/components/legal/business-facts';

export default function GuestNotice({ returnTo }: { returnTo: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-lg mx-auto">
      <div className="w-16 h-16 flex items-center justify-center bg-purple-50 rounded-full mx-auto mb-4">
        <i className="ri-lock-line text-3xl text-gsg-purple" aria-hidden="true"></i>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to use support tickets</h1>
      <p className="text-gray-600 mb-6">
        Tickets are linked to your account so you can follow our replies. No account? WhatsApp us or send us a message instead.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={`/auth/login?redirect=${encodeURIComponent(returnTo)}`}
          className="bg-gsg-purple hover:bg-gsg-purple-dark text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Sign in
        </Link>
        <a
          href={whatsappLink('Hi GSG, I need some help.')}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-gray-300 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
        >
          WhatsApp us
        </a>
        <Link
          href="/contact"
          className="border-2 border-gray-300 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
        >
          Contact form
        </Link>
      </div>
    </div>
  );
}
