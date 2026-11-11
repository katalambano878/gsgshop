'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Settings = {
  pixelId: string;
  catalogId: string;
  feedId: string;
  wabaId: string;
  phoneNumberId: string;
  autoSync: boolean;
  tokenSet: boolean;
  tokenLast4: string;
  lastSync: { at: string; ok: boolean; sent: number; removed?: number; message?: string } | null;
  updatedAt: string | null;
};

type Check = { label: string; ok: boolean; detail: string };

type FormState = {
  pixelId: string;
  catalogId: string;
  wabaId: string;
  phoneNumberId: string;
  autoSync: boolean;
  accessToken: string;
};

const toForm = (s: Settings): FormState => ({
  pixelId: s.pixelId,
  catalogId: s.catalogId,
  wabaId: s.wabaId,
  phoneNumberId: s.phoneNumberId,
  autoSync: s.autoSync,
  accessToken: '',
});

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Session expired — please log in again.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminMetaPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [feedUrl, setFeedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const apply = (data: any) => {
    setSettings(data.settings);
    setForm(toForm(data.settings));
    if (data.feedUrl) setFeedUrl(data.feedUrl);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/meta', { headers: await authHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
        apply(data);
      } catch (err: any) {
        setMessage({ type: 'error', text: err.message || 'Failed to load settings.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [field]: field === 'autoSync' ? e.target.checked : e.target.value } : f));

  const save = async (extra?: { accessToken?: null }) => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/meta', {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({
          pixelId: form.pixelId,
          catalogId: form.catalogId,
          wabaId: form.wabaId,
          phoneNumberId: form.phoneNumberId,
          autoSync: form.autoSync,
          ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save');
      apply(data);
      setChecks(null);
      setMessage({ type: 'success', text: extra?.accessToken === null ? 'Access token removed.' : 'Saved.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const run = async (action: 'test' | 'setup' | 'sync' | 'whatsapp') => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/meta/action', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (action === 'test' && data.checks) {
        setChecks(data.checks);
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error || 'Meta request failed');
      if (action === 'whatsapp') {
        setMessage({
          type: 'success',
          text: `Catalogue connected to WhatsApp${data.number ? ` ${data.number}` : ''}. Customers can now browse it in the chat.`,
        });
      } else {
        const s = data.sync;
        setMessage({
          type: 'success',
          text:
            (action === 'setup' ? 'Hourly feed set up. ' : '') +
            `${s.sent} products sent to the catalogue${s.removed ? `, ${s.removed} removed` : ''}.`,
        });
      }
      const refreshed = await fetch('/api/admin/meta', { headers: await authHeaders() }).then((r) => r.json());
      if (refreshed.success) apply(refreshed);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Meta request failed.' });
    } finally {
      setBusy(null);
    }
  };

  const copyFeed = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the URL is selectable */
    }
  };

  if (loading || !form || !settings) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-500">
        {loading ? (
          <>
            <i className="ri-loader-4-line animate-spin text-xl" /> Loading Meta settings…
          </>
        ) : (
          message?.text
        )}
      </div>
    );
  }

  const field = (label: string, key: 'pixelId' | 'catalogId' | 'wabaId' | 'phoneNumberId', hint: string) => (
    <div>
      <label htmlFor={`meta-${key}`} className="block text-sm font-bold text-gray-700 mb-1">{label}</label>
      <input
        id={`meta-${key}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={form[key]}
        onChange={set(key)}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none font-mono text-sm"
      />
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );

  const button = (action: 'test' | 'setup' | 'sync' | 'whatsapp', label: string, icon: string, disabled = false) => (
    <button
      type="button"
      onClick={() => run(action)}
      disabled={disabled || busy !== null || saving}
      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-800 hover:border-purple-400 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <i className={busy === action ? 'ri-loader-4-line animate-spin' : icon} />
      {label}
    </button>
  );

  const canSync = settings.tokenSet && Boolean(settings.catalogId);
  const canWhatsApp = canSync && Boolean(settings.wabaId) && Boolean(settings.phoneNumberId);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Meta &amp; WhatsApp</h1>
        <p className="text-sm text-gray-500 mt-1">
          Facebook &amp; Instagram Pixel, the product catalogue for Facebook / Instagram shops, and the WhatsApp catalogue.
          Product changes made in admin are sent to Meta automatically.
        </p>
      </div>

      {message && (
        <div
          role="status"
          className={`mb-6 p-4 rounded-xl border text-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Credentials</h2>
            <p className="text-xs text-gray-500 mb-5">
              Find these in Meta Business Settings (business.facebook.com/settings). Save, then use the buttons on the right.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {field('Pixel ID', 'pixelId', 'Events Manager → Data sources. Used on every page of both sites.')}
              {field('Catalogue ID', 'catalogId', 'Commerce Manager → your catalogue → Settings.')}
              {field('WhatsApp Business Account ID', 'wabaId', 'WhatsApp Manager → Account tools → Account ID.')}
              {field('WhatsApp phone number ID', 'phoneNumberId', 'WhatsApp Manager → Phone numbers → 0579 033 792 → ID.')}
            </div>

            <div className="mt-4">
              <label htmlFor="meta-token" className="block text-sm font-bold text-gray-700 mb-1">Access token</label>
              <input
                id="meta-token"
                type="password"
                autoComplete="new-password"
                value={form.accessToken}
                onChange={set('accessToken')}
                placeholder={settings.tokenSet ? `Saved (ends in …${settings.tokenLast4}). Paste a new one to replace it.` : 'Paste a System User access token'}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Business Settings → Users → System users → Generate token, with <span className="font-mono">catalog_management</span>,{' '}
                <span className="font-mono">business_management</span> and <span className="font-mono">whatsapp_business_management</span>.
                Stored encrypted; it is never shown again.
              </p>
              {settings.tokenSet && (
                <button
                  type="button"
                  onClick={() => save({ accessToken: null })}
                  disabled={saving}
                  className="mt-2 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove saved token
                </button>
              )}
            </div>

            <label className="mt-5 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.autoSync} onChange={set('autoSync')} className="mt-1 h-4 w-4 accent-purple-600" />
              <span className="text-sm text-gray-700">
                <span className="font-semibold">Send product changes to Meta automatically</span>
                <span className="block text-xs text-gray-500">When a product is saved in admin, its price, stock and photo go straight to the catalogue.</span>
              </span>
            </label>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => save()}
                disabled={saving || busy !== null}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
              >
                {saving && <i className="ri-loader-4-line animate-spin" />}
                Save
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Product feed</h2>
            <p className="text-xs text-gray-500 mb-4">
              Public list of products for Meta. It always shows the current admin prices, stock and photos.
              Products without a price or photo are left out — Meta won't accept them.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={feedUrl}
                aria-label="Feed URL"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50 font-mono text-xs"
              />
              <button
                type="button"
                onClick={copyFeed}
                className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold hover:bg-gray-50"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Connect</h2>
            <div className="grid gap-3">
              {button('test', 'Test connection', 'ri-shield-check-line', !settings.tokenSet)}
              {button('setup', settings.feedId ? 'Sync all products now' : 'Set up catalogue (hourly feed + sync)', 'ri-refresh-line', !canSync)}
              {button('whatsapp', 'Show catalogue on WhatsApp', 'ri-whatsapp-line', !canWhatsApp)}
            </div>
            {!settings.tokenSet && (
              <p className="text-xs text-gray-500 mt-3">Save an access token to enable these.</p>
            )}

            {checks && (
              <ul className="mt-5 space-y-2">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2 text-sm">
                    <i className={`mt-0.5 ${c.ok ? 'ri-checkbox-circle-fill text-emerald-600' : 'ri-error-warning-fill text-red-500'}`} />
                    <span>
                      <span className="font-semibold text-gray-800">{c.label}:</span>{' '}
                      <span className="text-gray-600 break-words">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Status</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Hourly feed</dt>
                <dd className="font-semibold text-gray-800">{settings.feedId ? 'On' : 'Not set up'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Last sync</dt>
                <dd className="font-semibold text-gray-800 text-right">
                  {settings.lastSync
                    ? `${fmtTime(settings.lastSync.at)} · ${settings.lastSync.ok ? `${settings.lastSync.sent} products` : 'failed'}`
                    : 'Never'}
                </dd>
              </div>
              {settings.lastSync && !settings.lastSync.ok && settings.lastSync.message && (
                <p className="text-xs text-red-600">{settings.lastSync.message}</p>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
