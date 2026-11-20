'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import OrderHistory from './OrderHistory';
import AddressBook from './AddressBook';
import { supabase } from '@/lib/supabase';
import { isGhanaPhone, normalizeGhanaPhone } from '@/lib/phone';
import PageHero from '@/components/PageHero';

const TAB_IDS = ['profile', 'orders', 'addresses', 'security'];

const TABS = [
  { id: 'profile', icon: 'ri-user-settings-line', label: 'Profile Settings', short: 'Profile' },
  { id: 'orders', icon: 'ri-shopping-bag-3-line', label: 'Order History', short: 'Orders' },
  { id: 'addresses', icon: 'ri-map-pin-2-line', label: 'Addresses', short: 'Address' },
  { id: 'security', icon: 'ri-shield-keyhole-line', label: 'Security', short: 'Security' },
];

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

const inputCls =
  'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gsg-purple focus:border-gsg-purple transition-all bg-gray-50 focus:bg-white outline-none';

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'profile';

  const [activeTab, setActiveTab] = useState(TAB_IDS.includes(initialTab) ? initialTab : 'profile');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Update active tab when URL param changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && TAB_IDS.includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Profile Form States
  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  });
  const [profileMessage, setProfileMessage] = useState({ type: '', text: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // Password Form States
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    password: '',
    confirmPassword: ''
  });
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push(`/auth/login?redirect=${encodeURIComponent('/account')}`);
        return;
      }

      setUser(session.user);
      const meta = session.user.user_metadata || {};
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', session.user.id)
        .maybeSingle();
      const fromProfile = splitName(profile?.full_name || '');
      setProfileData({
        firstName: fromProfile.first || meta.first_name || '',
        lastName: fromProfile.first ? fromProfile.last : (meta.last_name || ''),
        email: session.user.email || '',
        phone: profile?.phone || meta.phone || ''
      });
      setLoading(false);
    }
    checkUser();
  }, [router]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage({ type: '', text: '' });

    const typedPhone = profileData.phone.trim();
    if (typedPhone && !isGhanaPhone(typedPhone)) {
      setProfileMessage({ type: 'error', text: 'Enter a Ghana mobile number, for example 024 603 3792.' });
      return;
    }
    const phone = typedPhone ? normalizeGhanaPhone(typedPhone) : null;
    const fullName = `${profileData.firstName.trim()} ${profileData.lastName.trim()}`.trim();

    setProfileLoading(true);
    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName || null, phone, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (profileError) throw profileError;

      // Read back what was stored so the form shows the saved values.
      const { data: saved, error: readError } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', user.id)
        .maybeSingle();
      if (readError || !saved) throw readError || new Error('not saved');
      const savedName = splitName(saved.full_name || '');
      setProfileData((prev) => ({
        ...prev,
        firstName: savedName.first,
        lastName: savedName.last,
        phone: saved.phone || '',
      }));

      // Keep the sign-in details in step (used by the header greeting and checkout prefill).
      await supabase.auth.updateUser({
        data: {
          first_name: savedName.first,
          last_name: savedName.last,
          phone: saved.phone || '',
        }
      });
      setProfileMessage({ type: 'success', text: 'Your details were saved.' });
    } catch {
      setProfileMessage({ type: 'error', text: 'Your details could not be saved. Please try again.' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage({ type: '', text: '' });
    if (!passwordData.currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Enter your current password.' });
      return;
    }
    if (passwordData.password.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Your new password must be at least 8 characters.' });
      return;
    }
    if (passwordData.password !== passwordData.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'The new passwords do not match.' });
      return;
    }
    if (passwordData.password === passwordData.currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Choose a new password that is different from the current one.' });
      return;
    }

    setPasswordLoading(true);
    try {
      // The server checks the current password (or a recent sign-in) before changing it.
      const { data, error } = await supabase.auth.updateUser({
        password: passwordData.password,
        current_password: passwordData.currentPassword,
      } as any);
      if (error) {
        const code = String((error as any).code || '');
        const status = (error as any).status;
        if (code === 'current_password_mismatch') {
          setPasswordMessage({ type: 'error', text: 'Your current password is not correct.' });
        } else if (code === 'reauthentication_needed') {
          setPasswordMessage({ type: 'error', text: 'For your security, please sign out, sign in again and then change your password.' });
        } else if (code === 'weak_password') {
          setPasswordMessage({ type: 'error', text: 'Your new password must be at least 8 characters.' });
        } else if (status === 429) {
          setPasswordMessage({ type: 'error', text: error.message || 'Too many attempts. Please wait a few minutes and try again.' });
        } else {
          setPasswordMessage({ type: 'error', text: 'Your password could not be changed. Please try again.' });
        }
        return;
      }

      setPasswordData({ currentPassword: '', password: '', confirmPassword: '' });
      // The old tokens stop working; the reply carries a fresh session.
      const fresh = (data?.user as any)?.session;
      if (fresh?.access_token && fresh?.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token,
        });
        if (!sessionError) {
          setPasswordMessage({ type: 'success', text: 'Your password was changed.' });
          return;
        }
      }
      await supabase.auth.signOut({ scope: 'local' });
      router.push('/auth/login?changed=1');
      router.refresh();
    } catch {
      setPasswordMessage({ type: 'error', text: 'Your password could not be changed. Please try again.' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  };

  const goToChangePassword = () => {
    setActiveTab('profile');
    router.replace('/account?tab=profile#change-password');
    setTimeout(() => document.getElementById('change-password')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <i className="ri-loader-4-line animate-spin text-4xl text-gsg-purple" aria-label="Loading"></i>
      </div>
    );
  }

  const securityOptions: { icon: string; title: string; description: string; href: string | null; onClick: null | (() => void) }[] = [
    {
      icon: 'ri-mail-line',
      title: 'Sign-in email',
      description: user?.email || '',
      href: null,
      onClick: null,
    },
    {
      icon: 'ri-lock-password-line',
      title: 'Change password',
      description: 'Confirm your current password, then choose a new one',
      href: null,
      onClick: goToChangePassword,
    },
    {
      icon: 'ri-shield-user-line',
      title: 'Privacy & data',
      description: 'Download your data or ask us to delete your account',
      href: '/account/privacy',
      onClick: null,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHero title="My Account" subtitle="Manage your profile, orders, and settings" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pb-24">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-gsg-purple text-2xl font-bold shadow-sm border border-gray-100" aria-hidden="true">
              {profileData.firstName?.[0] || user?.email?.[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gsg-black">
                {profileData.firstName ? `Hello, ${profileData.firstName}!` : 'Welcome Back'}
              </h1>
              <p className="text-gray-500 font-medium">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-full hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all font-bold shadow-sm w-full md:w-auto justify-center"
          >
            <i className="ri-logout-box-r-line" aria-hidden="true"></i>
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Desktop Sidebar Navigation */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden sticky top-24">
              <nav className="p-3 space-y-1" aria-label="Account sections">
                {TABS.map(tab => (
                  <button
                    type="button"
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all text-left group ${activeTab === tab.id
                      ? 'bg-gsg-purple text-white shadow-md'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gsg-purple'
                      }`}
                  >
                    <i className={`${tab.icon} text-xl ${activeTab === tab.id ? 'text-white' : 'text-gray-400 group-hover:text-gsg-purple'}`} aria-hidden="true"></i>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Mobile Horizontal Navigation */}
          <div className="lg:hidden col-span-1 pb-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 min-w-max">
              {TABS.map(tab => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold whitespace-nowrap transition-all border shadow-sm ${activeTab === tab.id
                    ? 'bg-gsg-purple text-white border-gsg-purple'
                    : 'bg-white text-gray-600 border-gray-200'
                    }`}
                >
                  <i className={tab.icon} aria-hidden="true"></i>
                  <span>{tab.short}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 min-h-[500px]">
              {activeTab === 'profile' && (
                <div className="max-w-2xl">
                  <h2 className="text-2xl font-bold text-gsg-black mb-2">Profile Information</h2>
                  <p className="text-gray-500 mb-8">Update your name and phone number. We use your phone for order updates by SMS and WhatsApp.</p>

                  {profileMessage.text && (
                    <div role={profileMessage.type === 'error' ? 'alert' : 'status'} className={`mb-6 p-4 rounded-xl flex items-start gap-3 ${profileMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                      <i className={`text-xl mt-0.5 ${profileMessage.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}`} aria-hidden="true"></i>
                      <div>{profileMessage.text}</div>
                    </div>
                  )}

                  <form onSubmit={handleUpdateProfile} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label htmlFor="first-name" className="text-sm font-bold text-gsg-black">First Name</label>
                        <input
                          id="first-name"
                          type="text"
                          autoComplete="given-name"
                          value={profileData.firstName}
                          onChange={e => setProfileData({ ...profileData, firstName: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="last-name" className="text-sm font-bold text-gsg-black">Last Name</label>
                        <input
                          id="last-name"
                          type="text"
                          autoComplete="family-name"
                          value={profileData.lastName}
                          onChange={e => setProfileData({ ...profileData, lastName: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="email-address" className="text-sm font-bold text-gsg-black">Email Address</label>
                      <div className="relative">
                        <i className="ri-mail-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"></i>
                        <input
                          id="email-address"
                          type="email"
                          value={profileData.email}
                          disabled
                          aria-describedby="email-readonly"
                          className="w-full pl-11 pr-4 py-3 border border-gray-200 bg-gray-100 rounded-xl text-gray-500 cursor-not-allowed"
                        />
                        <span id="email-readonly" className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold bg-gray-200 text-gray-600 px-2 py-1 rounded">Read Only</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="phone-number" className="text-sm font-bold text-gsg-black">Phone Number</label>
                      <div className="relative">
                        <i className="ri-phone-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"></i>
                        <input
                          id="phone-number"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={profileData.phone}
                          onChange={e => setProfileData({ ...profileData, phone: e.target.value })}
                          placeholder="024 XXX XXXX"
                          className={`${inputCls} pl-11`}
                        />
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={profileLoading}
                        className="px-8 py-3 bg-gsg-black hover:bg-gsg-purple text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:shadow-none"
                      >
                        {profileLoading ? 'Saving...' : 'Save Profile Information'}
                      </button>
                    </div>
                  </form>

                  <div id="change-password" className="mt-12 pt-12 border-t border-gray-100 scroll-mt-24">
                    <h3 className="text-xl font-bold text-gsg-black mb-2">Change Password</h3>
                    <p className="text-gray-500 mb-6">Enter your current password, then choose a new one of at least 8 characters. Other devices will be signed out.</p>

                    {passwordMessage.text && (
                      <div role={passwordMessage.type === 'error' ? 'alert' : 'status'} className={`mb-6 p-4 rounded-xl flex items-start gap-3 ${passwordMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                        <i className={`text-xl mt-0.5 ${passwordMessage.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}`} aria-hidden="true"></i>
                        <div>{passwordMessage.text}</div>
                      </div>
                    )}

                    <form onSubmit={handleChangePassword} className="space-y-5">
                      <div className="space-y-2">
                        <label htmlFor="current-password" className="text-sm font-bold text-gsg-black">Current Password</label>
                        <div className="relative">
                          <i className="ri-key-2-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"></i>
                          <input
                            id="current-password"
                            type="password"
                            autoComplete="current-password"
                            value={passwordData.currentPassword}
                            onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                            className={`${inputCls} pl-11`}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label htmlFor="new-password" className="text-sm font-bold text-gsg-black">New Password</label>
                          <div className="relative">
                            <i className="ri-lock-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"></i>
                            <input
                              id="new-password"
                              type="password"
                              autoComplete="new-password"
                              minLength={8}
                              placeholder="At least 8 characters"
                              value={passwordData.password}
                              onChange={e => setPasswordData({ ...passwordData, password: e.target.value })}
                              className={`${inputCls} pl-11`}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="confirm-password" className="text-sm font-bold text-gsg-black">Confirm New Password</label>
                          <div className="relative">
                            <i className="ri-lock-check-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true"></i>
                            <input
                              id="confirm-password"
                              type="password"
                              autoComplete="new-password"
                              value={passwordData.confirmPassword}
                              onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                              className={`${inputCls} pl-11`}
                            />
                          </div>
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={passwordLoading}
                        className="px-8 py-3 bg-white border-2 border-gray-200 hover:border-gsg-black text-gsg-black hover:text-gsg-black rounded-xl font-bold transition-all disabled:opacity-50"
                      >
                        {passwordLoading ? 'Updating...' : 'Update Password'}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {activeTab === 'orders' && <OrderHistory />}

              {activeTab === 'addresses' && <AddressBook />}

              {activeTab === 'security' && (
                <div>
                  <h2 className="text-2xl font-bold text-gsg-black mb-6">Security Settings</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {securityOptions.map((option) => {
                      const inner = (
                        <>
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center group-hover:bg-gsg-purple group-hover:text-white transition-colors flex-shrink-0 text-gsg-purple">
                              <i className={`${option.icon} text-xl`} aria-hidden="true"></i>
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-gsg-black">{option.title}</h3>
                              <p className="text-sm text-gray-500 break-words">{option.description}</p>
                            </div>
                          </div>
                          {(option.href || option.onClick) && (
                            <i className="ri-arrow-right-line text-gray-300 group-hover:text-gsg-purple transition-colors flex-shrink-0" aria-hidden="true"></i>
                          )}
                        </>
                      );
                      const cls = 'flex items-center justify-between gap-3 p-5 border border-gray-200 rounded-2xl transition-all group bg-white text-left w-full';
                      if (option.href) {
                        return (
                          <Link key={option.title} href={option.href} className={`${cls} hover:border-gsg-purple hover:shadow-md`}>
                            {inner}
                          </Link>
                        );
                      }
                      if (option.onClick) {
                        return (
                          <button key={option.title} type="button" onClick={option.onClick} className={`${cls} hover:border-gsg-purple hover:shadow-md`}>
                            {inner}
                          </button>
                        );
                      }
                      return (
                        <div key={option.title} className={cls}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <i className="ri-loader-4-line animate-spin text-4xl text-gsg-purple" aria-label="Loading"></i>
      </div>
    }>
      <AccountContent />
    </Suspense>
  );
}
