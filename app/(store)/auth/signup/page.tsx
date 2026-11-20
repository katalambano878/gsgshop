'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import PasswordStrengthMeter from '@/components/PasswordStrengthMeter';
import { supabase } from '@/lib/supabase';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { isGhanaPhone, normalizeGhanaPhone } from '@/lib/phone';
import { safeInternalPath } from '../safe-next';

function getFriendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('email rate limit exceeded') || lower.includes('over_email_send_rate_limit')) {
    return 'Our system is experiencing high demand. Please wait a few minutes and try again, or contact us for help.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('password') && lower.includes('weak')) {
    return 'Your password is too weak. Please use at least 8 characters with a mix of letters, numbers, and symbols.';
  }
  if (lower.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Connection error. Please check your internet and try again.';
  }
  return message;
}

export default function SignupPage() {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const { getToken, verifying } = useRecaptcha();

  const [redirectTo, setRedirectTo] = useState('/account');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectTo(safeInternalPath(params.get('redirect') || params.get('next'), '/account'));
  }, []);
  const loginHref = redirectTo !== '/account' ? `/auth/login?redirect=${encodeURIComponent(redirectTo)}` : '/auth/login';

  // Auto-scroll to error when it appears
  useEffect(() => {
    if (authError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [authError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setAuthError('');
    setIsLoading(true);

    const newErrors: any = {};
    if (!formData.firstName) newErrors.firstName = 'First name is required';
    if (!formData.lastName) newErrors.lastName = 'Last name is required';
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!formData.phone) {
      newErrors.phone = 'Phone number is required';
    } else if (!isGhanaPhone(formData.phone)) {
      newErrors.phone = 'Enter a Ghana mobile number, for example 024 603 3792';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    if (!formData.acceptTerms) {
      newErrors.acceptTerms = 'You must accept the terms and conditions';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    // reCAPTCHA verification
    const isHuman = await getToken('signup');
    if (!isHuman) {
      setAuthError('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    const phone = normalizeGhanaPhone(formData.phone) || formData.phone.trim();

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            phone,
          }
        }
      });

      if (error) throw error;

      // Sign-up never returns a session (so it cannot reveal who is registered): sign in now.
      const signIn = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      });
      if (signIn.error || !signIn.data.session) {
        setAuthError("We couldn't create an account with this email. If you already have one, sign in, or contact us on WhatsApp.");
        return;
      }
      const userId = signIn.data.session.user.id;
      // Save the name and phone on the profile too, so the shop sees them.
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: `${firstName} ${lastName}`.trim(), phone, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (profileError) console.error('Profile save after sign-up failed:', profileError.message);
      void data;
      router.push(redirectTo);
      router.refresh();
    } catch (err: any) {
      console.error('Signup error:', err);
      const code = String(err?.code || '');
      if (code === 'weak_password') setAuthError('Your password must be at least 8 characters.');
      else if (code === 'validation_failed') setAuthError('Please enter a valid email address.');
      else if (err?.status === 429) setAuthError('Too many attempts. Please wait a few minutes and try again.');
      else setAuthError(getFriendlyError(err?.message || 'Failed to sign up. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <div className="relative w-16 h-16 mx-auto">
              <Image src="/fgfg.png" alt="GSG Logo" fill className="object-contain" />
            </div>
          </Link>
          <h1 className="text-3xl font-bold text-gsg-black mb-2">Create Account</h1>
          <p className="text-gray-500">Join us and start shopping today</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {authError && (
            <div ref={errorRef} className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-start gap-3">
              <i className="ri-error-warning-fill text-lg flex-shrink-0 mt-0.5"></i>
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="signup-first-name" className="block text-sm font-bold text-gsg-black mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  id="signup-first-name"
                  value={formData.firstName}
                  aria-invalid={!!errors.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.firstName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                    }`}
                  autoComplete="given-name"
                />
                {errors.firstName && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{errors.firstName}</p>
                )}
              </div>
              <div>
                <label htmlFor="signup-last-name" className="block text-sm font-bold text-gsg-black mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  id="signup-last-name"
                  value={formData.lastName}
                  aria-invalid={!!errors.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.lastName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                    }`}
                  autoComplete="family-name"
                />
                {errors.lastName && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{errors.lastName}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="signup-email" className="block text-sm font-bold text-gsg-black mb-2">
                  Email Address
                </label>
              <input
                type="email"
                id="signup-email"
                autoComplete="email"
                value={formData.email}
                aria-invalid={!!errors.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.email ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                  }`}
                placeholder="you@example.com"
              />
              {errors.email && (
                <p className="text-xs text-red-500 mt-1 font-medium">{errors.email}</p>
              )}
            </div>

            <div>
              <label htmlFor="signup-phone" className="block text-sm font-bold text-gsg-black mb-2">
                  Phone Number
                </label>
              <input
                type="tel"
                id="signup-phone"
                value={formData.phone}
                aria-invalid={!!errors.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.phone ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                  }`}
                placeholder="024 XXX XXXX"
                inputMode="tel"
                autoComplete="tel"
              />
              {errors.phone && (
                <p className="text-xs text-red-500 mt-1 font-medium">{errors.phone}</p>
              )}
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-sm font-bold text-gsg-black mb-2">
                  Password
                </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="signup-password"
                  autoComplete="new-password"
                  value={formData.password}
                  aria-invalid={!!errors.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.password ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                    }`}
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gsg-purple transition-colors"
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                </button>
              </div>
              <PasswordStrengthMeter password={formData.password} />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1 font-medium">{errors.password}</p>
              )}
            </div>

            <div>
              <label htmlFor="signup-confirm-password" className="block text-sm font-bold text-gsg-black mb-2">
                  Confirm Password
                </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="signup-confirm-password"
                  autoComplete="new-password"
                  value={formData.confirmPassword}
                  aria-invalid={!!errors.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all outline-none ${errors.confirmPassword ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                    }`}
                  placeholder="Re-enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gsg-purple transition-colors"
                >
                  <i className={`${showConfirmPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1 font-medium">{errors.confirmPassword}</p>
              )}
            </div>

            <div>
              <label className="flex items-start space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.acceptTerms}
                  onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
                  className="w-4 h-4 mt-1 text-gsg-purple rounded focus:ring-gsg-purple"
                />
                <span className="text-sm text-gray-600 group-hover:text-gsg-black transition-colors">
                  I agree to the{' '}
                  <Link href="/terms" className="text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
                    Terms & Conditions
                  </Link>
                  {' '}and{' '}
                  <Link href="/privacy" className="text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {errors.acceptTerms && (
                <p className="text-xs text-red-500 mt-1 font-medium">{errors.acceptTerms}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || verifying}
              className="w-full bg-gsg-black hover:bg-gsg-purple text-white py-4 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer mt-2"
            >
              {isLoading || verifying ? (
                <span className="flex items-center justify-center">
                  <i className="ri-loader-4-line animate-spin mr-2"></i> {verifying ? 'Verifying...' : 'Creating account...'}
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="mt-8 text-center text-gray-600 text-sm">
            Already have an account?{' '}
            <Link href={loginHref} className="text-gsg-purple hover:text-gsg-purple-dark font-bold hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-500 hover:text-gsg-black font-medium inline-flex items-center transition-colors">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
