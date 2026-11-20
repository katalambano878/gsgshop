'use client';

import { supabase } from '@/lib/supabase';

/**
 * fetch() for the dashboard's staff routes: adds the signed-in user's
 * Bearer token and JSON headers, and returns the parsed body with the
 * status so callers can show the server's message.
 */
export async function adminFetch<T = any>(
  url: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection and try again.' } as any };
  }
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok && !data.error && !data.message) {
    data.error =
      res.status === 401 ? 'Your session has expired. Please sign in again.'
      : res.status === 403 ? 'You do not have permission to do this. Ask an admin.'
      : `Request failed (${res.status}).`;
  }
  return { ok: res.ok, status: res.status, data };
}

/** The message to show for a failed adminFetch. */
export function errorText(data: { error?: string; message?: string } | null | undefined, fallback = 'Something went wrong.'): string {
  return (data && (data.error || data.message)) || fallback;
}

/** Plain "ask an admin" panel for admin-only pages viewed by staff. */
export const ADMIN_ONLY_MESSAGE = 'This page is for admins only. Ask an admin if something here needs changing.';
