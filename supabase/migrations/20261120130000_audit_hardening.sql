-- GSG Goods audit, part 2 (2026-11-20): the rest of the database changes.
-- Safe to run twice. Run as the database owner (store_gsg_goods).
--
-- Server code connects as the owner with no auth.uid() and no request role;
-- the checks below apply to browser callers only.

-- ---------------------------------------------------------------------------
-- 1. Orders and payments: guards that hold whatever the code does.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_quantity_positive') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0);
  END IF;
END $$;

-- A retried till sale with the same key can never create a second order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uniq
  ON public.orders ((metadata->>'idempotency_key'))
  WHERE metadata ? 'idempotency_key';

-- One gateway transaction pays one order (or one shopper request), never two.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_txn_uniq
  ON public.orders (payment_provider, payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL
    AND payment_transaction_id <> ''
    AND payment_transaction_id NOT LIKE '%-verify'
    AND payment_transaction_id <> 'callback';
CREATE UNIQUE INDEX IF NOT EXISTS shopper_payment_txn_uniq
  ON public.shopper_requests (payment_provider, payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL
    AND payment_transaction_id <> ''
    AND payment_transaction_id NOT LIKE '%-verify'
    AND payment_transaction_id <> 'callback';
CREATE UNIQUE INDEX IF NOT EXISTS shopper_requests_request_number_uniq
  ON public.shopper_requests (request_number);

-- ---------------------------------------------------------------------------
-- 2. mark_order_paid: does nothing the second time. Returns the order either
--    way, with "already_paid": true when it was paid before this call. Stock
--    comes off the right variant; a coupon is counted once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_order_paid(order_ref text, moolre_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_order orders;
  existing_order orders;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Only staff can mark orders paid' USING ERRCODE = '42501';
  END IF;

  UPDATE orders
  SET payment_status = 'paid',
      status = CASE
        WHEN status = 'pending'          THEN 'processing'::order_status
        WHEN status = 'awaiting_payment' THEN 'processing'::order_status
        ELSE status
      END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'moolre_reference',    moolre_ref,
        'payment_verified_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
  WHERE order_number = order_ref
    AND payment_status IS DISTINCT FROM 'paid'
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    SELECT * INTO existing_order FROM orders WHERE order_number = order_ref;
    IF existing_order.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN to_jsonb(existing_order) || '{"already_paid": true}'::jsonb;
  END IF;

  IF (updated_order.metadata->>'stock_reduced') IS NULL THEN
    -- Variant lines: by variant id, else by variant name.
    UPDATE product_variants pv
    SET    quantity = GREATEST(0, pv.quantity - oi.quantity), updated_at = now()
    FROM   order_items oi
    WHERE  oi.order_id = updated_order.id
      AND  oi.variant_id IS NOT NULL
      AND  oi.variant_id = pv.id;

    UPDATE product_variants pv
    SET    quantity = GREATEST(0, pv.quantity - oi.quantity), updated_at = now()
    FROM   order_items oi
    WHERE  oi.order_id = updated_order.id
      AND  oi.variant_id IS NULL
      AND  oi.product_id = pv.product_id
      AND  oi.variant_name IS NOT NULL
      AND  oi.variant_name = pv.name;

    -- Products without variants: straight off the product.
    UPDATE products p
    SET    quantity = GREATEST(0, p.quantity - oi.quantity), updated_at = now()
    FROM   order_items oi
    WHERE  oi.order_id = updated_order.id
      AND  oi.product_id = p.id
      AND  NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

    -- Products with variants: the product total is the sum of its variants.
    UPDATE products p
    SET    quantity = s.total, updated_at = now()
    FROM (
      SELECT v.product_id, COALESCE(SUM(v.quantity), 0)::int AS total
      FROM   product_variants v
      WHERE  v.product_id IN (
        SELECT DISTINCT oi.product_id FROM order_items oi
        WHERE oi.order_id = updated_order.id AND oi.product_id IS NOT NULL
      )
      GROUP BY v.product_id
    ) s
    WHERE p.id = s.product_id;

    UPDATE orders
    SET    metadata = COALESCE(metadata, '{}'::jsonb) || '{"stock_reduced": true}'::jsonb
    WHERE  id = updated_order.id
    RETURNING * INTO updated_order;
  END IF;

  IF COALESCE(updated_order.metadata->>'coupon_code', '') <> '' THEN
    UPDATE coupons SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = now()
    WHERE upper(code) = upper(updated_order.metadata->>'coupon_code');
  END IF;

  RETURN to_jsonb(updated_order);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(text, text) FROM PUBLIC, gsg_goods_anon;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(text, text) TO gsg_goods_authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_shopper_request_paid: same rule. One "PAID" history row, ever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_shopper_request_paid(request_ref text, txn_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated public.shopper_requests;
  existing public.shopper_requests;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.shopper_requests sr
  SET    payment_status = 'paid',
         status         = CASE
                            WHEN sr.status IN ('SUBMITTED','REVIEWING','SOURCING','AWAITING_CONFIRMATION')
                              THEN 'PAID'::shopper_request_status
                            ELSE sr.status
                          END,
         paid_at        = COALESCE(sr.paid_at, now()),
         metadata       = COALESCE(sr.metadata, '{}'::jsonb) || jsonb_build_object(
                            'payment_reference',  txn_ref,
                            'payment_verified_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                          ),
         updated_at     = now()
  WHERE  (sr.request_number = request_ref OR sr.id::text = request_ref)
    AND  sr.payment_status IS DISTINCT FROM 'paid'
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    SELECT * INTO existing FROM public.shopper_requests sr
    WHERE sr.request_number = request_ref OR sr.id::text = request_ref
    LIMIT 1;
    IF existing.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN to_jsonb(existing) || '{"already_paid": true}'::jsonb;
  END IF;

  INSERT INTO public.shopper_status_history (request_id, status, note)
  VALUES (updated.id, 'PAID', 'Payment confirmed by gateway');

  RETURN to_jsonb(updated);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_shopper_request_paid(text, text) FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;

-- ---------------------------------------------------------------------------
-- 4. Customer records: written by the server and staff only, and one
--    customer's record can no longer be re-pointed at another account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(p_email text, p_phone text, p_full_name text, p_first_name text, p_last_name text, p_user_id uuid DEFAULT NULL::uuid, p_address jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id UUID;
  v_existing_email TEXT;
  v_existing_phone TEXT;
  v_existing_secondary_email TEXT;
  v_existing_secondary_phone TEXT;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Only staff can write customer records' USING ERRCODE = '42501';
  END IF;

  SELECT id, email, phone, secondary_email, secondary_phone
  INTO v_customer_id, v_existing_email, v_existing_phone, v_existing_secondary_email, v_existing_secondary_phone
  FROM customers
  WHERE email = p_email OR secondary_email = p_email
  LIMIT 1;
  IF v_customer_id IS NULL AND p_phone IS NOT NULL AND p_phone != '' THEN
    SELECT id, email, phone, secondary_email, secondary_phone
    INTO v_customer_id, v_existing_email, v_existing_phone, v_existing_secondary_email, v_existing_secondary_phone
    FROM customers
    WHERE phone = p_phone OR secondary_phone = p_phone
    LIMIT 1;
  END IF;
  IF v_customer_id IS NULL THEN
    INSERT INTO customers (email, phone, full_name, first_name, last_name, user_id, default_address)
    VALUES (p_email, p_phone, p_full_name, p_first_name, p_last_name, p_user_id, p_address)
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE customers SET
      secondary_email = CASE
        WHEN p_email IS NOT NULL AND p_email != '' AND p_email != v_existing_email
             AND (v_existing_secondary_email IS NULL OR v_existing_secondary_email = '')
        THEN p_email ELSE secondary_email END,
      secondary_phone = CASE
        WHEN p_phone IS NOT NULL AND p_phone != '' AND p_phone != v_existing_phone
             AND (v_existing_secondary_phone IS NULL OR v_existing_secondary_phone = '')
        THEN p_phone ELSE secondary_phone END,
      full_name = COALESCE(NULLIF(full_name, ''), NULLIF(p_full_name, '')),
      first_name = COALESCE(NULLIF(first_name, ''), NULLIF(p_first_name, '')),
      last_name = COALESCE(NULLIF(last_name, ''), NULLIF(p_last_name, '')),
      user_id = COALESCE(user_id, p_user_id),
      default_address = COALESCE(p_address, default_address),
      updated_at = NOW()
    WHERE id = v_customer_id;
  END IF;
  RETURN v_customer_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.upsert_customer_from_order(text, text, text, text, text, uuid, jsonb) FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;

-- Customer totals: recalculated from paid orders that are not cancelled or
-- refunded (matched by account, email, or the last 9 digits of the phone).
CREATE OR REPLACE FUNCTION public.recompute_customer_stats(p_customer_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed integer;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  WITH s AS (
    SELECT c.id,
           count(o.id)::int            AS n,
           COALESCE(sum(o.total), 0)   AS t,
           max(o.created_at)           AS last_at
    FROM customers c
    LEFT JOIN orders o
      ON o.payment_status = 'paid'
     AND o.status NOT IN ('cancelled', 'refunded')
     AND (
          (c.user_id IS NOT NULL AND o.user_id = c.user_id)
       OR (o.email !~* '@(pos|store|whatsapp)\.local$'
           AND lower(o.email) IN (lower(c.email), lower(c.secondary_email)))
       OR (length(regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')) >= 9
           AND right(regexp_replace(o.phone, '\D', '', 'g'), 9) IN (
                 right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 9),
                 right(regexp_replace(COALESCE(c.secondary_phone, ''), '\D', '', 'g'), 9)))
     )
    WHERE p_customer_id IS NULL OR c.id = p_customer_id
    GROUP BY c.id
  )
  UPDATE customers c
  SET    total_orders = s.n,
         total_spent = s.t,
         last_order_at = COALESCE(s.last_at, c.last_order_at),
         updated_at = now()
  FROM   s
  WHERE  c.id = s.id
    AND (c.total_orders IS DISTINCT FROM s.n OR c.total_spent IS DISTINCT FROM s.t);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_customer_stats_for_order(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cid uuid;
  total integer := 0;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  FOR cid IN
    SELECT c.id
    FROM orders o
    JOIN customers c
      ON (c.user_id IS NOT NULL AND o.user_id = c.user_id)
      OR (o.email !~* '@(pos|store|whatsapp)\.local$'
          AND lower(o.email) IN (lower(c.email), lower(c.secondary_email)))
      OR (length(regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g')) >= 9
          AND right(regexp_replace(o.phone, '\D', '', 'g'), 9) IN (
                right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 9),
                right(regexp_replace(COALESCE(c.secondary_phone, ''), '\D', '', 'g'), 9)))
    WHERE o.id = p_order_id
  LOOP
    total := total + public.recompute_customer_stats(cid);
  END LOOP;
  RETURN total;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recompute_customer_stats(uuid) FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_customer_stats_for_order(uuid) FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
SELECT public.recompute_customer_stats();

-- ---------------------------------------------------------------------------
-- 5. Reviews, returns and support tickets: customers cannot approve their own
--    review, set a refund, read staff-only notes or reassign a ticket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reviews_pin_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.helpful_votes := 0;
  ELSE
    NEW.helpful_votes := OLD.helpful_votes;
    NEW.user_id := OLD.user_id;
    NEW.product_id := OLD.product_id;
    IF NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.content IS DISTINCT FROM OLD.content THEN
      NEW.status := 'pending';
    ELSE
      NEW.status := OLD.status;
    END IF;
  END IF;
  NEW.verified_purchase := EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.user_id = NEW.user_id
      AND o.payment_status = 'paid'
      AND oi.product_id = NEW.product_id
  );
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_reviews_pin_moderation ON public.reviews;
CREATE TRIGGER trg_reviews_pin_moderation
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public._reviews_pin_moderation();

CREATE OR REPLACE FUNCTION public._returns_pin_for_customers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.refund_amount := NULL;
  NEW.refund_method := NULL;
  NEW.admin_notes := NULL;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'That order is not on your account';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_returns_pin_for_customers ON public.return_requests;
CREATE TRIGGER trg_returns_pin_for_customers
  BEFORE INSERT ON public.return_requests
  FOR EACH ROW EXECUTE FUNCTION public._returns_pin_for_customers();

DROP POLICY IF EXISTS "Users view ticket messages" ON public.support_messages;
CREATE POLICY "Users view ticket messages" ON public.support_messages FOR SELECT
  USING (is_internal = false AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users create messages" ON public.support_messages;
CREATE POLICY "Users create messages" ON public.support_messages FOR INSERT
  WITH CHECK (is_internal = false AND user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Guest can create tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets" ON public.support_tickets FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users create own tickets" ON public.support_tickets;
CREATE POLICY "Users create own tickets" ON public.support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own tickets" ON public.support_tickets;
CREATE POLICY "Users update own tickets" ON public.support_tickets FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public._tickets_pin_for_customers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_staff() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.assigned_to := NULL;
    NEW.priority := 'medium';
    NEW.status := 'open';
  ELSE
    NEW.assigned_to := OLD.assigned_to;
    NEW.priority := OLD.priority;
    NEW.user_id := OLD.user_id;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('open', 'closed') THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_tickets_pin_for_customers ON public.support_tickets;
CREATE TRIGGER trg_tickets_pin_for_customers
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public._tickets_pin_for_customers();

-- ---------------------------------------------------------------------------
-- 6. Contact form and newsletter: saved by the server only; staff read them
--    in the dashboard and mark a message handled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read contact submissions" ON public.contact_submissions;
CREATE POLICY "Staff read contact submissions" ON public.contact_submissions
  FOR SELECT USING (public.is_admin_or_staff());
DROP POLICY IF EXISTS "Staff update contact submissions" ON public.contact_submissions;
CREATE POLICY "Staff update contact submissions" ON public.contact_submissions
  FOR UPDATE USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
REVOKE ALL ON public.contact_submissions FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
GRANT SELECT, UPDATE (status) ON public.contact_submissions TO gsg_goods_authenticated;

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_key
  ON public.newsletter_subscribers (lower(email));
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read newsletter subscribers" ON public.newsletter_subscribers;
CREATE POLICY "Staff read newsletter subscribers" ON public.newsletter_subscribers
  FOR SELECT USING (public.is_admin_or_staff());
REVOKE ALL ON public.newsletter_subscribers FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
GRANT SELECT ON public.newsletter_subscribers TO gsg_goods_authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public reads: only what the shop shows. Staff still see everything.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public view categories" ON public.categories;
CREATE POLICY "Public view categories" ON public.categories FOR SELECT
  USING (status = 'active' OR public.is_admin_or_staff());

DROP POLICY IF EXISTS "Public can view pages" ON public.pages;
CREATE POLICY "Public can view pages" ON public.pages FOR SELECT
  USING (status = 'published' OR public.is_admin_or_staff());

DROP POLICY IF EXISTS "Public view variants" ON public.product_variants;
CREATE POLICY "Public view variants" ON public.product_variants FOR SELECT
  USING (public.is_admin_or_staff() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND p.status = 'active'));

DROP POLICY IF EXISTS "Public view images" ON public.product_images;
CREATE POLICY "Public view images" ON public.product_images FOR SELECT
  USING (public.is_admin_or_staff() OR EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_images.product_id AND p.status = 'active'));

DROP POLICY IF EXISTS "Staff view settings" ON public.store_settings;
CREATE POLICY "Staff view settings" ON public.store_settings FOR SELECT
  USING (public.is_admin_or_staff());

-- ---------------------------------------------------------------------------
-- 8. Functions browsers never need to call directly.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user(), public.update_product_rating_stats(),
  public.update_updated_at_column(), public.shopper_requests_set_request_number(),
  public.fuzzy_product_search(text, integer, real)
  FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
REVOKE ALL ON FUNCTION public._reviews_pin_moderation() FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
REVOKE ALL ON FUNCTION public._returns_pin_for_customers() FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;
REVOKE ALL ON FUNCTION public._tickets_pin_for_customers() FROM PUBLIC, gsg_goods_anon, gsg_goods_authenticated;

-- ---------------------------------------------------------------------------
-- 9. Modules (which dashboard menu links show) are changed by admins only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow admin insert" ON public.store_modules;
CREATE POLICY "Allow admin insert" ON public.store_modules FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS "Allow admin update" ON public.store_modules;
CREATE POLICY "Allow admin update" ON public.store_modules FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
