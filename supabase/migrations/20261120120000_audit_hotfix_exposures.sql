-- GSG Goods audit, part 1: exposures closed immediately (2026-11-20).
-- Safe to run twice. Run as the database owner (store_gsg_goods).
-- None of these paths is used by the site: checkout and Personal Shopper
-- requests are created by server routes, the till is staff, and guests read
-- their request back through /api/shopper/requests.

-- 1. Orders and order lines are no longer insertable through the data API.
DROP POLICY IF EXISTS "Allow order creation" ON public.orders;
DROP POLICY IF EXISTS "Enable insert for order items" ON public.order_items;

-- 2. Personal Shopper: guest requests (name, phone, address, notes) are no
--    longer readable by everyone; nobody but staff and the server writes them.
DROP POLICY IF EXISTS "Users can view own requests" ON public.shopper_requests;
DROP POLICY IF EXISTS "Users view own requests" ON public.shopper_requests;
CREATE POLICY "Users view own requests" ON public.shopper_requests
  FOR SELECT TO gsg_goods_authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own items" ON public.shopper_request_items;
DROP POLICY IF EXISTS "Users view own items" ON public.shopper_request_items;
CREATE POLICY "Users view own items" ON public.shopper_request_items
  FOR SELECT TO gsg_goods_authenticated
  USING (EXISTS (SELECT 1 FROM public.shopper_requests r WHERE r.id = request_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own history" ON public.shopper_status_history;
DROP POLICY IF EXISTS "Users view own history" ON public.shopper_status_history;
CREATE POLICY "Users view own history" ON public.shopper_status_history
  FOR SELECT TO gsg_goods_authenticated
  USING (EXISTS (SELECT 1 FROM public.shopper_requests r WHERE r.id = request_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own attachments" ON public.shopper_attachments;
DROP POLICY IF EXISTS "Users view own attachments" ON public.shopper_attachments;
CREATE POLICY "Users view own attachments" ON public.shopper_attachments
  FOR SELECT TO gsg_goods_authenticated
  USING (EXISTS (SELECT 1 FROM public.shopper_requests r WHERE r.id = request_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "Anyone can insert requests" ON public.shopper_requests;
DROP POLICY IF EXISTS "Anyone can insert items" ON public.shopper_request_items;
DROP POLICY IF EXISTS "Anyone can insert history" ON public.shopper_status_history;
DROP POLICY IF EXISTS "Anyone can insert attachments" ON public.shopper_attachments;

-- 3. The stored Meta / WhatsApp tokens (encrypted) are no longer in the
--    public settings read.
DROP POLICY IF EXISTS "Allow public read on site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "Public read on site_settings" ON public.site_settings;
CREATE POLICY "Public read on site_settings" ON public.site_settings
  FOR SELECT USING (key <> 'meta_integration' OR public.is_admin_or_staff());

-- 4. Coupon codes are readable by staff only.
DROP POLICY IF EXISTS "Allow anon read access to coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow authenticated read access to coupons" ON public.coupons;
DROP POLICY IF EXISTS "Staff read coupons" ON public.coupons;
CREATE POLICY "Staff read coupons" ON public.coupons
  FOR SELECT TO gsg_goods_authenticated USING (public.is_admin_or_staff());

-- 5. Browser roles never need these table privileges.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gsg_goods_anon, gsg_goods_authenticated;
