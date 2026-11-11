import { supabase } from '@/lib/supabase';

/**
 * Admin pages → Meta catalogue, without making the admin wait. Sends the
 * request in the background (keepalive survives the page navigating away);
 * the server only acts when Admin → Meta & WhatsApp has auto-sync on and a
 * catalogue + token saved. Never throws.
 */
export async function notifyMetaCatalog(
    body: { action: 'product'; productIds: string[] } | { action: 'remove'; skus: string[] }
): Promise<void> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        void fetch('/api/admin/meta/action', {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify(body),
        }).catch(() => {});
    } catch {
        /* tracking the catalogue must never block a product save */
    }
}
