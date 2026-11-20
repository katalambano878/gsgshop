'use client';

import { useState, useEffect } from 'react';

export default function UpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    // Listen for SW update events from PWAInstaller
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.registration) {
        setRegistration(detail.registration);
        setShowPrompt(true);
      }
    };

    window.addEventListener('sw-update-available', handleUpdate);

    // Also check directly
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg.waiting) {
          setRegistration(reg);
          setShowPrompt(true);
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setRegistration(reg);
                setShowPrompt(true);
              }
            });
          }
        });
      });
    }

    return () => window.removeEventListener('sw-update-available', handleUpdate);
  }, []);

  // The customer chose to update: activate the waiting version, then reload
  // once it has taken control (or straight away if nothing is waiting).
  const handleUpdate = () => {
    const waiting = registration?.waiting;
    if (waiting && 'serviceWorker' in navigator) {
      let reloaded = false;
      const reload = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
      // Fallback in case the controller change event never arrives.
      setTimeout(reload, 4000);
      return;
    }
    window.location.reload();
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-[9998] pwa-update-toast">
      <div className="bg-gray-900 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <i className="ri-refresh-line text-xl" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Update available</p>
          <p className="text-xs text-gray-400">Finish what you are doing, then tap Update</p>
        </div>
        <button
          type="button"
          onClick={handleUpdate}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 active:scale-95"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setShowPrompt(false)}
          className="text-gray-500 hover:text-white p-1 flex-shrink-0"
          aria-label="Dismiss update message"
        >
          <i className="ri-close-line text-lg" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
