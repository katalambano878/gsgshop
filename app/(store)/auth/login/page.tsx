'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { safeInternalPath } from '../safe-next';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [redirectTo, setRedirectTo] = useState('/account');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const { getToken, verifying } = useRecaptcha();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectTo(safeInternalPath(params.get('redirect') || params.get('next'), '/account'));
    if (params.get('changed') === '1') {
      setNotice('Password changed. Please sign in with your new password.');
    } else if (params.get('expired') === '1') {
      setNotice('You were signed out after a period of inactivity. Please sign in again.');
    }
  }, []);

  const signupHref = redirectTo !== '/account' ? `/auth/signup?redirect=${encodeURIComponent(redirectTo)}` : '/auth/signup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setAuthError('');
    setIsLoading(true);

    // Validation
    const newErrors: any = {};
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    // reCAPTCHA verification
    const isHuman = await getToken('login');
    if (!isHuman) {
      setAuthError('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        router.push(redirectTo);
        router.refresh(); // Refresh to update auth state in other components
      }
    } catch (error: any) {
      console.error('Login error:', error);
      // Show the server's message (wrong password, too many attempts, …).
      setAuthError(error?.message || 'Failed to sign in. Please check your details.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6" aria-label="GSG home">
            <div className="relative w-16 h-16 mx-auto">
              <Image src="/fgfg.png" alt="GSG Logo" fill className="object-contain" />
            </div>
          </Link>
          <h1 className="text-3xl font-bold text-gsg-black mb-2">Welcome Back</h1>
          <p className="text-gray-500">Sign in to your account to continue</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {notice && !authError && (
            <div role="status" className="mb-6 p-4 bg-green-50 border border-green-100 text-green-700 rounded-xl text-sm flex items-start gap-3">
              <i className="ri-checkbox-circle-fill text-lg mt-0.5" aria-hidden="true"></i>
              <span>{notice}</span>
            </div>
          )}

          {authError && (
            <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-start gap-3">
              <i className="ri-error-warning-fill text-lg mt-0.5" aria-hidden="true"></i>
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="login-email" className="block text-sm font-bold text-gsg-black mb-2">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.email ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                  }`}
                placeholder="you@example.com"
              />
              {errors.email && (
                <p id="login-email-error" className="text-xs text-red-500 mt-1 font-medium">{errors.email}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="login-password" className="block text-sm font-bold text-gsg-black">
                  Password
                </label>
                <Link href="/auth/forgot-password" className="text-sm text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.password ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                    }`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gsg-purple transition-colors"
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`} aria-hidden="true"></i>
                </button>
              </div>
              {errors.password && (
                <p id="login-password-error" className="text-xs text-red-500 mt-1 font-medium">{errors.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || verifying}
              className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer mt-2"
            >
              {isLoading || verifying ? (
                <span className="flex items-center justify-center">
                  <i className="ri-loader-4-line animate-spin mr-2" aria-hidden="true"></i> {verifying ? 'Verifying...' : 'Signing in...'}
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          <p className="mt-8 text-center text-gray-600 text-sm">
            Don&apos;t have an account?{' '}
            <Link href={signupHref} className="text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
              Create one now
            </Link>
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-500 hover:text-gsg-black font-medium inline-flex items-center transition-colors">
            <i className="ri-arrow-left-line mr-2" aria-hidden="true"></i>
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
