'use client';

import { useEffect, useState } from 'react';
import { adminFetch, errorText } from '@/components/admin/adminFetch';

type Audience = 'all' | 'newsletter';

const AUDIENCES: { value: Audience; label: string; note: string }[] = [
    { value: 'all', label: 'All customers', note: 'Every customer with a real phone number on their record.' },
    { value: 'newsletter', label: 'Newsletter subscribers', note: 'People who signed up to the newsletter and have not unsubscribed, where we have a phone number for them.' },
];

const MAX_LENGTH = 480;

export default function NotificationsPage() {
    const [audience, setAudience] = useState<Audience>('all');
    const [message, setMessage] = useState('');
    const [count, setCount] = useState<number | null>(null);
    const [countError, setCountError] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ recipients: number; sent: number; failed: number } | null>(null);
    const [error, setError] = useState('');

    // The server builds the recipient list; this only asks how many there are.
    useEffect(() => {
        let cancelled = false;
        setCount(null);
        setCountError('');
        adminFetch<{ count: number }>(`/api/notifications?audienceCount=${audience}`).then((res) => {
            if (cancelled) return;
            if (!res.ok || typeof res.data.count !== 'number') {
                setCountError(errorText(res.data, 'Could not count recipients.'));
            } else {
                setCount(res.data.count);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [audience]);

    const smsParts = Math.max(1, Math.ceil(message.length / 160));
    const audienceLabel = AUDIENCES.find((a) => a.value === audience)?.label.toLowerCase() || 'customers';
    const canSend = !sending && message.trim().length > 0 && count !== null && count > 0;

    const startConfirm = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setResult(null);
        if (!canSend) return;
        setConfirming(true);
    };

    const handleSend = async () => {
        setSending(true);
        setError('');
        try {
            const res = await adminFetch<{ success: boolean; recipients: number; sent: number; failed: number }>('/api/notifications', {
                body: {
                    type: 'campaign',
                    payload: { audience, channels: { sms: true }, message: message.trim() },
                },
            });
            setConfirming(false);
            if (!res.ok) {
                setError(`Campaign not sent: ${errorText(res.data)}`);
                return;
            }
            const r = {
                recipients: Number(res.data.recipients || 0),
                sent: Number(res.data.sent || 0),
                failed: Number(res.data.failed || 0),
            };
            setResult(r);
            if (r.sent > 0) setMessage('');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">Marketing & Notifications</h1>

            <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-xl font-semibold mb-2">Send an SMS campaign</h2>
                <p className="text-sm text-gray-600 mb-6">
                    Campaigns go out by SMS only. The shop has no email sending.
                </p>

                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-lg mb-6">
                    <i className="ri-money-dollar-circle-line text-amber-600 text-xl mt-0.5"></i>
                    <p className="text-sm">
                        Every SMS costs money from the shop&apos;s SMS balance, and each message longer than 160 characters is charged as more than one.
                        A campaign cannot be stopped or called back once it is sent.
                    </p>
                </div>

                {result && (
                    <div className={`p-4 rounded-lg mb-4 ${result.sent > 0 ? 'bg-blue-50 text-blue-800' : 'bg-red-50 text-red-700'}`} role="status">
                        {result.sent > 0
                            ? `Campaign finished: ${result.sent} of ${result.recipients} SMS sent${result.failed ? `, ${result.failed} failed` : ''}.`
                            : `Nothing was delivered (${result.failed} failed out of ${result.recipients}). Check the SMS balance and settings.`}
                    </div>
                )}
                {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4" role="alert">{error}</div>}

                <form onSubmit={startConfirm} className="space-y-6">
                    <div>
                        <label htmlFor="campaign-audience" className="block text-sm font-semibold text-gray-700 mb-2">Audience</label>
                        <select
                            id="campaign-audience"
                            value={audience}
                            onChange={e => { setAudience(e.target.value as Audience); setResult(null); }}
                            className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {AUDIENCES.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                        </select>
                        <p className="text-sm text-gray-500 mt-1">{AUDIENCES.find((a) => a.value === audience)?.note}</p>
                        <p className="text-sm font-medium text-gray-800 mt-2" aria-live="polite">
                            {countError
                                ? <span className="text-red-600">{countError}</span>
                                : count === null
                                    ? 'Counting recipients...'
                                    : `${count} recipient${count === 1 ? '' : 's'} will get this SMS.`}
                        </p>
                    </div>

                    <div>
                        <label htmlFor="campaign-message" className="block text-sm font-semibold text-gray-700 mb-2">Message</label>
                        <textarea
                            id="campaign-message"
                            value={message}
                            maxLength={MAX_LENGTH}
                            onChange={e => setMessage(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg h-40 outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Write your message here..."
                            required
                        />
                        <p className="text-sm text-gray-500 mt-1">
                            {message.length} characters: {smsParts} SMS per person
                            {count ? ` (about ${smsParts * count} SMS in total)` : ''}.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={!canSend}
                        className="w-full bg-blue-700 text-white py-4 rounded-lg font-bold text-lg hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        Review and send
                    </button>
                </form>
            </div>

            {confirming && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !sending && setConfirming(false)}>
                    <div
                        className="bg-white rounded-xl p-6 w-full max-w-md"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirm-campaign-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 id="confirm-campaign-title" className="text-xl font-bold text-gray-900 mb-2">Send this SMS?</h2>
                        <p className="text-sm text-gray-700 mb-3">
                            To <strong>{count}</strong> {audienceLabel}: {smsParts} SMS each, about <strong>{smsParts * (count || 0)}</strong> SMS charged to the shop&apos;s balance.
                        </p>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-y-auto mb-4">
                            {message.trim()}
                        </div>
                        <p className="text-xs text-gray-500 mb-4">Once sent it cannot be undone. Do not press Send twice.</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirming(false)}
                                disabled={sending}
                                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-semibold cursor-pointer disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={sending}
                                className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold cursor-pointer disabled:opacity-50"
                            >
                                {sending ? (
                                    <span className="flex items-center"><i className="ri-loader-4-line animate-spin mr-2"></i>Sending...</span>
                                ) : 'Send'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
