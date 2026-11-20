-- GSG Goods on plain Postgres: changes that go with the move off Supabase.
-- Safe to run twice. Run as the database owner (store_gsg_goods).

-- 1. Sessions can be revoked (sign-out everywhere, bans).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

-- 2. The paid-order webhook is sent by the app now; pg_net does not exist here.
DROP TRIGGER IF EXISTS wa_payment_confirmed ON public.orders;
DROP FUNCTION IF EXISTS public.notify_wa_payment_confirmed();

-- 3. A customer can no longer change their own role: only these profile
--    columns are writable from the browser.
REVOKE UPDATE ON public.profiles FROM gsg_goods_anon, gsg_goods_authenticated;
GRANT UPDATE (email, full_name, phone, avatar_url, date_of_birth, gender, preferences, updated_at)
  ON public.profiles TO gsg_goods_authenticated;

-- 4. Marking an order paid: staff, the server and the WhatsApp agent only.
CREATE OR REPLACE FUNCTION public.mark_order_paid(order_ref text, moolre_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE updated_order orders;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Only staff can mark orders paid' USING ERRCODE = '42501';
  END IF;
  UPDATE orders
  SET payment_status = 'paid',
      status = CASE WHEN status = 'pending' THEN 'processing'::order_status
                    WHEN status = 'awaiting_payment' THEN 'processing'::order_status
                    ELSE status END,
      metadata = COALESCE(metadata, '{}'::jsonb) ||
                 jsonb_build_object('moolre_reference', moolre_ref,
                                    'payment_verified_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  WHERE order_number = order_ref
  RETURNING * INTO updated_order;
  IF updated_order.id IS NOT NULL THEN
    IF (updated_order.metadata->>'stock_reduced') IS NULL THEN
      UPDATE products p SET quantity = GREATEST(0, p.quantity - oi.quantity)
      FROM order_items oi WHERE oi.order_id = updated_order.id AND oi.product_id = p.id;
      UPDATE product_variants pv SET quantity = GREATEST(0, pv.quantity - oi.quantity)
      FROM order_items oi WHERE oi.order_id = updated_order.id AND oi.product_id = pv.product_id
        AND oi.variant_name IS NOT NULL AND oi.variant_name = pv.name;
      UPDATE orders SET metadata = metadata || '{"stock_reduced": true}'::jsonb WHERE id = updated_order.id;
    END IF;
  ELSE
    SELECT * INTO updated_order FROM orders WHERE order_number = order_ref;
  END IF;
  RETURN to_jsonb(updated_order);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(text, text) FROM PUBLIC, gsg_goods_anon;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(text, text) TO gsg_goods_authenticated;

-- 5. Only signed-in callers (the till, which is staff) may write customer records.
REVOKE EXECUTE ON FUNCTION public.upsert_customer_from_order(text, text, text, text, text, uuid, jsonb) FROM PUBLIC, gsg_goods_anon;

-- 6. Server-only functions are not callable by browser roles.
REVOKE EXECUTE ON FUNCTION public.get_all_customer_emails(), public.get_all_customer_phones(),
  public.find_user_by_whatsapp_phone(text), public.get_ai_memories(text, integer),
  public.get_order_for_tracking(text, text), public.mark_shopper_request_paid(text, text),
  public.update_customer_stats(text, numeric), public.reduce_stock_on_order(uuid)
  FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
