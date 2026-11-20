'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase, syncAdminSessionCookie } from '@/lib/supabase';
import { useRecaptcha } from '@/hooks/useRecaptcha';

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams?.get('error') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { getToken, verifying } = useRecaptcha();

  // Only follow a redirect back into the dashboard: a same-site path under
  // /admin, never a protocol-relative (//host) or absolute URL, never login.
  const safeRedirect = (): string => {
    const raw = searchParams?.get('redirect') || '';
    if (!raw.startsWith('/admin') || raw.startsWith('//') || raw.includes('\\')) return '/admin';
    try {
      const url = new URL(raw, window.location.origin);
      const inAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
      if (url.origin !== window.location.origin || !inAdmin || url.pathname.startsWith('/admin/login')) return '/admin';
      return url.pathname + url.search + url.hash;
    } catch {
      return '/admin';
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // reCAPTCHA verification
    const isHuman = await getToken('admin_login');
    if (!isHuman) {
      setError('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data.session) {
        // The cookie the middleware reads, written the same way lib/supabase.ts
        // does (Secure only on https). Then a full page load so the server
        // check sees it.
        syncAdminSessionCookie(data.session);
        window.location.assign(safeRedirect());
        return;
      }
    } catch (err: any) {
      const msg = err?.message || 'Login failed';
      const lower = msg.toLowerCase();
      if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
        setError('Wrong email or password.');
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-4">
            <div className="relative w-16 h-16 mx-auto">
              <Image src="/fgfg.png" alt="GSG Logo" fill className="object-contain" />
            </div>
          </Link>
          <h1 className="text-3xl font-bold text-gsg-black mb-2">Admin Portal</h1>
          <p className="text-gray-500">Sign in to manage your store</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {urlError === 'session_expired' && !error && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3" role="status">
              <i className="ri-time-line text-amber-600 text-lg mt-0.5"></i>
              <p className="text-amber-800 text-sm">Your session expired. Please sign in again.</p>
            </div>
          )}
          {urlError === 'unauthorized' && !error && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3" role="status">
              <i className="ri-shield-user-line text-amber-600 text-lg mt-0.5"></i>
              <div>
                <p className="text-amber-800 font-bold text-sm">No dashboard access</p>
                <p className="text-amber-700 text-xs mt-1">This account is not a staff or admin account. Ask an admin to give you access, or sign in with a different account.</p>
              </div>
            </div>
          )}
          {urlError === 'no_profile' && !error && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3" role="status">
              <i className="ri-error-warning-line text-amber-600 text-lg mt-0.5"></i>
              <p className="text-amber-800 text-sm">We could not load your account details. Please sign in again, or ask an admin to check your account.</p>
            </div>
          )}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <i className="ri-error-warning-fill text-red-600 text-lg mt-0.5"></i>
              <div>
                <p className="text-red-800 font-bold text-sm">Login Failed</p>
                <p className="text-red-600 text-xs mt-1">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-bold text-gsg-black mb-2">
                Email Address
              </label>
              <div className="relative">
                <i className="ri-mail-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></i>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none border-gray-200 bg-gray-50 focus:bg-white"
                  placeholder="admin@gsgbrands.com"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-sm font-bold text-gsg-black mb-2">
                Password
              </label>
              <div className="relative">
                <i className="ri-lock-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></i>
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none border-gray-200 bg-gray-50 focus:bg-white"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gsg-purple transition-colors"
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-lg`}></i>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || verifying}
              className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap mt-2"
            >
              {isLoading || verifying ? (
                <span className="flex items-center justify-center space-x-2">
                  <i className="ri-loader-4-line animate-spin"></i>
                  <span>{verifying ? 'Verifying...' : 'Signing in...'}</span>
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-gray-500 hover:text-gsg-purple font-medium transition-colors inline-flex items-center">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Store
          </Link>
        </div>
      </div>
    </div>
  );
}
