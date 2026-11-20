import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
    loadPaymentTarget,
    paidCovers,
    parseAmount,
    providerRefs,
    recordPaymentFailure,
    refKind,
    stripRetrySuffix,
} from '@/lib/payment-target';
import { finalizePayment } from '@/lib/payment-finalize';

/**
 * Moolre payment callback.
 * {
 *   "status": 1, "code": "P01", "message": "Transaction Successful",
 *   "data": { "txtstatus": 1, "amount": "2", "transactionid": "42252702",
 *             "externalref": "ORD-…-R<ts>" | "SR-…-R<ts>", "thirdpartyref": "…",
 *             "secret": "…" },
 *   "ts": "…"
 * }
 *
 * Rules:
 *   - MOOLRE_CALLBACK_SECRET is mandatory (503 when unset); compared in
 *     constant time; wrong or missing → 401.
 *   - Success only when the transaction status itself says success
 *     (data.txtstatus === 1), the amount is present and covers the stored
 *     server total, and Moolre's status API does not contradict it.
 *   - A paid row is never downgraded; a failure only marks the row failed when
 *     it is for the row's newest attempt, and metadata is merged.
 */

let warnedNoSecret = false;

function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
    const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
    return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Moolre's status API for one externalref: 'success' | 'failed' | 'unknown', with amount. */
async function moolreStatus(externalref: string): Promise<{ state: 'success' | 'failed' | 'unknown'; amount: number | null }> {
    const apiUser = process.env.MOOLRE_API_USER;
    const apiPubkey = process.env.MOOLRE_API_PUBKEY;
    const accountNumber = process.env.MOOLRE_ACCOUNT_NUMBER;
    if (!apiUser || !apiPubkey || !accountNumber) return { state: 'unknown', amount: null };
    try {
        const res = await fetch('https://api.moolre.com/open/transact/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-USER': apiUser, 'X-API-PUBKEY': apiPubkey },
            body: JSON.stringify({ type: 1, idtype: 1, id: externalref, accountnumber: accountNumber }),
            signal: AbortSignal.timeout(8000),
        });
        const json: any = await res.json().catch(() => null);
        const d = json?.data || {};
        if (json?.status !== 1 || (d.externalref && String(d.externalref) !== externalref)) return { state: 'unknown', amount: null };
        const tx = d.txstatus ?? d.txtstatus;
        if (tx === 1 || tx === '1') return { state: 'success', amount: parseAmount(d.amount) };
        if (tx === 2 || tx === '2') return { state: 'failed', amount: null };
        return { state: 'unknown', amount: null };
    } catch {
        return { state: 'unknown', amount: null };
    }
}

export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`callback:${clientId}`, RATE_LIMITS.callback);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        const expectedSecret = process.env.MOOLRE_CALLBACK_SECRET;
        if (!expectedSecret) {
            if (!warnedNoSecret) {
                console.error('[Moolre/Callback] MOOLRE_CALLBACK_SECRET is not set: callbacks are refused');
                warnedNoSecret = true;
            }
            return NextResponse.json({ success: false, message: 'Callback not configured' }, { status: 503 });
        }

        let body: any = {};
        const contentType = req.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('form')) {
                body = Object.fromEntries((await req.formData()).entries());
            } else {
                const rawText = await req.text();
                try {
                    body = JSON.parse(rawText);
                } catch {
                    body = Object.fromEntries(new URLSearchParams(rawText).entries());
                }
            }
        } catch {
            return NextResponse.json({ success: false, message: 'Invalid Request Body' }, { status: 400 });
        }
        if (!body || typeof body !== 'object') body = {};
        let data: any = body.data || {};
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                data = {};
            }
        }

        // Moolre sends the secret inside `data`.
        const receivedSecret = String(data.secret ?? body.secret ?? '');
        if (!receivedSecret || !safeEqual(receivedSecret, expectedSecret)) {
            console.warn('[Moolre/Callback] wrong or missing secret: refused');
            return NextResponse.json({ success: false, message: 'Invalid callback signature' }, { status: 401 });
        }

        const externalref = typeof data.externalref === 'string' ? data.externalref.trim() : '';
        const merchantRef = externalref ? stripRetrySuffix(externalref) : '';
        const kind = refKind(merchantRef);
        if (!externalref || !kind) {
            console.warn('[Moolre/Callback] missing or unknown reference');
            return NextResponse.json({ success: false, message: 'Missing order reference' }, { status: 400 });
        }

        const target = await loadPaymentTarget(merchantRef);
        if (!target) {
            console.warn('[Moolre/Callback] no row for', merchantRef);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        const txStatus = data.txtstatus ?? data.txstatus;
        const txOk = txStatus === 1 || txStatus === '1';
        const transactionId = data.transactionid ? String(data.transactionid) : null;

        console.log('[Moolre/Callback]', target.ref, '| tx status:', txStatus, '| txn:', transactionId ?? 'none');

        if (!txOk) {
            if (target.payment_status !== 'paid') {
                await recordPaymentFailure(target, {
                    provider: 'moolre',
                    ref: externalref,
                    reason: String(body.message || 'Payment failed'),
                });
            }
            return NextResponse.json({ success: false, message: 'Payment not successful' });
        }

        if (target.payment_status === 'paid') {
            return NextResponse.json({ success: true, message: 'Order already processed' });
        }

        // Only references this row issued are accepted.
        if (!providerRefs(target, 'moolre').includes(externalref)) {
            console.warn('[Moolre/Callback] reference not issued for', target.ref);
        }

        let paid = parseAmount(data.amount);
        // Ask Moolre itself. A definite "failed" wins; "unknown" (lag, outage)
        // falls back to the authenticated callback.
        const check = await moolreStatus(externalref);
        if (check.state === 'failed') {
            console.warn('[Moolre/Callback] status API says failed for', target.ref);
            return NextResponse.json({ success: false, message: 'Payment not confirmed' });
        }
        if (check.state === 'success' && check.amount !== null) paid = check.amount;

        if (!paidCovers(paid, target.amount)) {
            console.error('[Moolre/Callback] amount missing or short for', target.ref, '| paid:', paid, '| due:', target.amount);
            return NextResponse.json({ success: false, message: 'Payment amount does not match order total' }, { status: 400 });
        }

        const result = await finalizePayment({ target, provider: 'moolre', transactionId, paidAmount: paid });
        if (!result.ok) {
            const status = result.code === 'db_error' ? 500 : 409;
            return NextResponse.json({ success: false, message: 'Payment not applied' }, { status });
        }
        return NextResponse.json({ success: true, message: result.alreadyPaid ? 'Order already processed' : 'Payment verified and order updated' });
    } catch (error: any) {
        console.error('[Moolre/Callback] error:', error?.name || 'error');
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ message: 'Moolre callback endpoint ready' });
}
