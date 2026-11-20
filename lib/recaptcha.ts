// Google reCAPTCHA v3 utilities
// Client-side: executeRecaptcha() to get a token
// Server-side: verifyRecaptcha() to validate the token

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Minimum score to pass verification (0.0 = bot, 1.0 = human)
const MIN_SCORE = 0.5;

/**
 * Client-side: Execute reCAPTCHA v3 and return a token.
 * Must be called in the browser after the reCAPTCHA script has loaded.
 */
export async function executeRecaptcha(action: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    if (!RECAPTCHA_SITE_KEY) {
        console.warn('[reCAPTCHA] NEXT_PUBLIC_RECAPTCHA_SITE_KEY not configured');
        return null;
    }

    try {
        // Wait for grecaptcha to be ready
        return await new Promise<string>((resolve, reject) => {
            const w = window as any;
            if (!w.grecaptcha) {
                reject(new Error('reCAPTCHA script not loaded'));
                return;
            }
            w.grecaptcha.ready(() => {
                w.grecaptcha
                    .execute(RECAPTCHA_SITE_KEY, { action })
                    .then(resolve)
                    .catch(reject);
            });
        });
    } catch (error) {
        console.error('[reCAPTCHA] Execute error:', error);
        return null;
    }
}

export type RecaptchaResult = {
    /** May the caller go ahead? True when verified, or when no secret is configured. */
    success: boolean;
    /** True only when Google actually verified the token. */
    verified: boolean;
    /** True when verification was skipped because RECAPTCHA_SECRET_KEY is unset. */
    skipped?: boolean;
    score?: number;
    error?: string;
};

let warnedNoSecret = false;

/**
 * Server-side: Verify a reCAPTCHA token with Google.
 *
 * With no RECAPTCHA_SECRET_KEY (the shop has none today) nothing can be
 * verified: this logs once and returns { success: true, verified: false,
 * skipped: true }. Callers must never describe that as verified.
 */
export async function verifyRecaptcha(token: string, expectedAction?: string): Promise<RecaptchaResult> {
    if (!RECAPTCHA_SECRET_KEY) {
        if (!warnedNoSecret) {
            console.warn('[reCAPTCHA] RECAPTCHA_SECRET_KEY is not set: tokens are not verified');
            warnedNoSecret = true;
        }
        return { success: true, verified: false, skipped: true };
    }

    if (!token || typeof token !== 'string' || token.length > 4000) {
        return { success: false, verified: false, error: 'No reCAPTCHA token provided' };
    }

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token }),
            signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();

        if (!data.success) {
            return { success: false, verified: false, error: 'reCAPTCHA verification failed', score: data.score };
        }
        if (expectedAction && data.action !== expectedAction) {
            return { success: false, verified: false, error: 'reCAPTCHA action mismatch', score: data.score };
        }
        if (typeof data.score === 'number' && data.score < MIN_SCORE) {
            return { success: false, verified: false, error: 'reCAPTCHA score too low', score: data.score };
        }
        return { success: true, verified: true, score: data.score };
    } catch {
        console.error('[reCAPTCHA] verification request failed');
        return { success: false, verified: false, error: 'reCAPTCHA verification request failed' };
    }
}
