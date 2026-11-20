'use server';

import { verifyAdminToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServerSupabase } from '@/lib/supabase-server';
import { normalizeGhanaPhone } from '@/lib/phone';

/** At most 5 test messages per admin per 10 minutes: each one costs money. */
const TEST_SMS_LIMIT = { maxRequests: 5, windowSeconds: 600 };

/** Records the send in audit_logs; only the last 3 digits of the number. */
async function auditTestSms(userId: string, phone: string, length: number, success: boolean, httpStatus?: number) {
    try {
        await createServerSupabase('service').from('audit_logs').insert({
            user_id: userId,
            action: 'test_sms_sent',
            entity_type: 'sms',
            details: { to: `***${phone.slice(-3)}`, length, success, httpStatus: httpStatus ?? null },
        });
    } catch {
        console.error('[Test SMS] Could not write the audit log entry');
    }
}

export async function testSmsAction(phone: string, message: string, authToken: string) {
    // Admins only (not staff): it sends real, paid messages to any number.
    const auth = await verifyAdminToken(authToken, { requireRole: 'admin' });
    if (!auth.authenticated) {
        return {
            success: false,
            error: auth.user ? 'Only an admin can use the SMS debugger.' : 'Your session has expired. Please sign in again.'
        };
    }

    const limit = checkRateLimit(`test-sms:${auth.user.id}`, TEST_SMS_LIMIT);
    if (!limit.success) {
        return {
            success: false,
            error: `Limit reached: 5 test messages per 10 minutes. Try again in ${Math.ceil(limit.resetIn / 60)} minute(s).`
        };
    }

    try {
        // Moolre SMS API only requires X-API-VASKEY for authentication
        const smsVasKey = process.env.MOOLRE_SMS_API_KEY;

        if (!smsVasKey) {
            return {
                success: false,
                error: 'Missing MOOLRE_SMS_API_KEY environment variable'
            };
        }

        // Validate phone input
        if (!phone || typeof phone !== 'string') {
            return { success: false, error: 'Invalid phone number' };
        }

        // Validate message input
        if (!message || typeof message !== 'string' || message.length > 480) {
            return { success: false, error: 'Enter a message of up to 480 characters.' };
        }

        // Ghana mobile numbers only.
        const recipient = normalizeGhanaPhone(phone);
        if (!recipient) {
            return { success: false, error: 'Enter a Ghana mobile number, for example 024 123 4567.' };
        }

        // Make API call per Moolre documentation
        const response = await fetch('https://api.moolre.com/open/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': smsVasKey
            },
            body: JSON.stringify({
                type: 1,
                senderid: process.env.SMS_SENDER_ID || 'GSGBRANDS',
                messages: [
                    {
                        recipient: recipient,
                        message: message
                    }
                ]
            })
        });

        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            result = { rawResponse: responseText };
        }

        const success = result?.status === 1;
        await auditTestSms(auth.user.id, recipient, message.length, success, response.status);

        return {
            success,
            result,
            formattedPhone: recipient,
            httpStatus: response.status
        };
    } catch (error: any) {
        // SECURITY: Don't expose stack traces
        console.error('[Test SMS] Send failed');
        return {
            success: false,
            error: 'SMS sending failed. Check the SMS settings and try again.'
        };
    }
}
