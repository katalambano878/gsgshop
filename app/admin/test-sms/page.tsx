'use client';

import { useState, useTransition } from 'react';
import { testSmsAction } from './actions';
import { supabase } from '@/lib/supabase';
import AdminOnly from '@/components/admin/AdminOnly';

export default function TestSmsPage() {
    return (
        <AdminOnly title="SMS Debugger">
            <TestSmsForm />
        </AdminOnly>
    );
}

function TestSmsForm() {
    const [isPending, startTransition] = useTransition();
    const [result, setResult] = useState<any>(null);
    const [phone, setPhone] = useState('024'); // Common start
    const [message, setMessage] = useState('Test message from GSG Goods');

    const handleSend = () => {
        setResult(null);
        startTransition(async () => {
            // Get auth token to pass to server action
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || '';
            const res = await testSmsAction(phone, message, token);
            setResult(res);
        });
    };

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-2">Test SMS Integration</h1>
            <p className="text-sm text-gray-600 mb-6">
                Sends one real SMS from the shop&apos;s sender ID. Each message costs money, you can send at most 5 every 10 minutes,
                and every send is recorded in the audit log.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h2 className="text-lg font-semibold mb-4">Send Test Request</h2>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="test-sms-phone" className="block text-sm font-medium text-gray-700 mb-1">
                                Phone Number
                            </label>
                            <input
                                id="test-sms-phone"
                                type="tel"
                                className="w-full border rounded-md p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="e.g. 024XXXXXXX"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Try local format (024...) to test auto-formatting (+23324...)
                            </p>
                        </div>

                        <div>
                            <label htmlFor="test-sms-message" className="block text-sm font-medium text-gray-700 mb-1">
                                Message
                            </label>
                            <textarea
                                id="test-sms-message"
                                maxLength={480}
                                className="w-full border rounded-md p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none h-24"
                                placeholder="Type your message..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                            />
                        </div>

                        <button
                            onClick={handleSend}
                            disabled={isPending}
                            className={`w-full py-2 px-4 rounded-md text-white font-medium transition-colors ${isPending
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            {isPending ? 'Sending...' : 'Send SMS'}
                        </button>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h2 className="text-lg font-semibold mb-4">Response & Debug Log</h2>

                    {result ? (
                        <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm overflow-auto max-h-[500px]">
                            <pre>{JSON.stringify(result, null, 2)}</pre>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 border-2 border-dashed rounded-md min-h-[200px]">
                            Waiting for response...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
