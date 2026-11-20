'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function PWASettingsPage() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [storageUsage, setStorageUsage] = useState({ used: 0, quota: 0 });
  const [cacheSize, setCacheSize] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then((estimate) => {
        setStorageUsage({
          used: estimate.usage || 0,
          quota: estimate.quota || 0
        });
      });
    }

    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        Promise.all(
          cacheNames.map((cacheName) =>
            caches.open(cacheName).then((cache) =>
              cache.keys().then((keys) => keys.length)
            )
          )
        ).then((counts) => {
          setCacheSize(counts.reduce((a, b) => a + b, 0));
        });
      });
    }
  }, []);

  const [cacheMessage, setCacheMessage] = useState('');
  const clearCache = async () => {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      setCacheSize(0);
      setCacheMessage('Saved pages were cleared from this device.');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-800 mb-6 whitespace-nowrap"
        >
          <i className="ri-arrow-left-line"></i>
          Back to Home
        </Link>

        <div className="bg-white rounded-2xl shadow-sm p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">PWA Settings</h1>
          <p className="text-gray-600">Manage your app installation and preferences</p>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <i className="ri-smartphone-line text-blue-700"></i>
              </div>
              Installation Status
            </h2>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="font-semibold text-gray-900 mb-1">App Installed</p>
                <p className="text-sm text-gray-600">
                  {isInstalled ? 'App is installed on this device' : 'App is not installed'}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                isInstalled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
              }`}>
                <i className={isInstalled ? 'ri-check-line text-2xl' : 'ri-close-line text-2xl'}></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <i className="ri-database-line text-orange-700"></i>
              </div>
              Storage & Cache
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-gray-900">Storage Usage</p>
                  <span className="text-sm text-gray-600">
                    {formatBytes(storageUsage.used)} of {formatBytes(storageUsage.quota)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-orange-600 h-full rounded-full transition-all"
                    style={{ width: `${storageUsage.quota ? Math.min(100, (storageUsage.used / storageUsage.quota) * 100) : 0}%` }}
                  ></div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <p className="font-semibold text-gray-900 mb-1">Cached Items</p>
                  <p className="text-sm text-gray-600">{cacheSize} items stored locally</p>
                </div>
                <button
                  type="button"
                  onClick={clearCache}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
                >
                  Clear Cache
                </button>
              </div>

              {cacheMessage && <p role="status" className="text-sm text-green-700">{cacheMessage}</p>}

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <i className="ri-information-line text-yellow-700 text-xl"></i>
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium mb-1">About Cache</p>
                    <p>Saved pages help the shop load faster and let you see some pages you have already opened when you are offline. Ordering and paying always need a connection.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <i className="ri-flashlight-line text-green-700"></i>
              </div>
              PWA Features
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 bg-green-50 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <i className="ri-wifi-off-line text-green-700 text-xl"></i>
                  <span className="font-semibold text-green-900">Offline Mode</span>
                </div>
                <p className="text-sm text-green-800">See some pages you have already opened while offline</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <i className="ri-rocket-line text-blue-700 text-xl"></i>
                  <span className="font-semibold text-blue-900">Fast Loading</span>
                </div>
                <p className="text-sm text-blue-800">Saved pages load faster on repeat visits</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <i className="ri-home-line text-purple-700 text-xl"></i>
                  <span className="font-semibold text-purple-900">Home Screen</span>
                </div>
                <p className="text-sm text-purple-800">Add to home screen like a native app</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <i className="ri-refresh-line text-orange-700 text-xl"></i>
                  <span className="font-semibold text-orange-900">Auto Updates</span>
                </div>
                <p className="text-sm text-orange-800">New versions download in the background</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}