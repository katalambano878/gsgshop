'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

const IDLE_TIMEOUT = 25 * 60 * 1000;
const WARNING_TIME = 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Signs a signed-in customer out after 25 minutes without activity, with a
 * one-minute warning first. Guests are never affected, and nobody is moved
 * off the page they are on (a checkout in progress stays where it is).
 */
export default function SessionTimeoutWarning() {
  const [signedIn, setSignedIn] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const lastActivity = useRef(Date.now());
  const signingOut = useRef(false);

  // Follow the real session: only signed-in visitors get a timeout.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setSignedIn(!!session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (session) lastActivity.current = Date.now();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setShowWarning(false);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      signingOut.current = false;
      setSignedIn(false);
      setSignedOutNotice(true);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setShowWarning(false);
      return;
    }
    lastActivity.current = Date.now();

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));

    const checkInterval = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_TIMEOUT) {
        void signOut();
      } else if (idle >= IDLE_TIMEOUT - WARNING_TIME) {
        setShowWarning(true);
        setCountdown(Math.ceil((IDLE_TIMEOUT - idle) / 1000));
      } else {
        setShowWarning(false);
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity));
      clearInterval(checkInterval);
    };
  }, [signedIn, signOut]);

  const handleStaySignedIn = () => {
    lastActivity.current = Date.now();
    setShowWarning(false);
    setCountdown(60);
  };

  if (signedOutNotice) {
    return (
      <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white border border-gray-200 rounded-xl shadow-xl p-4 flex items-start gap-3">
        <i className="ri-time-line text-xl text-orange-600 mt-0.5" aria-hidden="true"></i>
        <p className="text-sm text-gray-700 flex-1">
          You were signed out after 25 minutes without activity.{' '}
          <Link
            href={`/auth/login?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/account')}`}
            className="font-semibold text-gsg-purple underline"
          >
            Sign in again
          </Link>
        </p>
        <button
          type="button"
          onClick={() => setSignedOutNotice(false)}
          aria-label="Dismiss"
          className="text-gray-400 hover:text-gray-600"
        >
          <i className="ri-close-line text-xl" aria-hidden="true"></i>
        </button>
      </div>
    );
  }

  if (!signedIn || !showWarning) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        aria-describedby="session-timeout-desc"
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
            <i className="ri-time-line text-2xl text-orange-600" aria-hidden="true"></i>
          </div>
          <div>
            <h3 id="session-timeout-title" className="font-bold text-lg">Still there?</h3>
            <p className="text-sm text-gray-600">You are about to be signed out</p>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <p id="session-timeout-desc" className="text-sm text-gray-700 mb-2">
            You will be signed out in:
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-orange-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-1000"
                style={{ width: `${(countdown / 60) * 100}%` }}
              />
            </div>
            <span className="text-2xl font-bold text-orange-600 tabular-nums">
              {countdown}s
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium whitespace-nowrap"
          >
            Sign out now
          </button>
          <button
            type="button"
            autoFocus
            onClick={handleStaySignedIn}
            className="flex-1 px-4 py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium whitespace-nowrap"
          >
            Stay signed in
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          For your security, you are signed out after 25 minutes without activity.
        </p>
      </div>
    </div>
  );
}
