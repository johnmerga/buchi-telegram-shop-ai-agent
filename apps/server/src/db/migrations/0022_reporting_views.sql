-- The owner assistant answers questions with one model-written SELECT over these views. The views
-- leave out phone numbers, customer names, pins, and lowest prices. They are owned by app_user,
-- which cannot bypass row-level security, so every view shows only the shop set by withShop.
CREATE VIEW report_orders AS
SELECT
  o.id AS order_id,
  o.created_at,
  o.status,
  o.status IN ('paid', 'dispatching', 'assigned', 'out_for_delivery', 'ready_for_pickup', 'delivered') AS paid,
  o.delivery_type,
  o.items_total,
  o.delivery_fee,
  o.total,
  o.customer_id
FROM orders o;
--> statement-breakpoint
CREATE VIEW report_sales AS
SELECT
  oi.order_id,
  o.created_at AS sold_at,
  p.id AS product_id,
  p.title AS product_title,
  v.size,
  v.color,
  oi.quantity,
  oi.unit_price,
  oi.quantity * oi.unit_price AS line_total
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN product_variants v ON v.id = oi.variant_id
JOIN products p ON p.id = v.product_id
WHERE o.status IN ('paid', 'dispatching', 'assigned', 'out_for_delivery', 'ready_for_pickup', 'delivered');
--> statement-breakpoint
CREATE VIEW report_stock AS
SELECT
  p.id AS product_id,
  p.title AS product_title,
  p.pricing_mode,
  p.price,
  p.active,
  p.created_at AS listed_at,
  v.id AS variant_id,
  v.size,
  v.color,
  v.stock,
  v.reserved,
  v.stock - v.reserved AS available
FROM product_variants v
JOIN products p ON p.id = v.product_id;
--> statement-breakpoint
CREATE VIEW report_deliveries AS
SELECT
  j.id AS job_id,
  j.created_at,
  j.delivered_at,
  j.status,
  j.special,
  j.driver_id,
  s.delivery_type,
  s.stops,
  round(j.route_meters / 1000.0, 1) AS route_km,
  s.fees,
  j.payout,
  s.fees - j.payout AS margin,
  j.estimated_minutes,
  j.actual_minutes
FROM delivery_jobs j
JOIN LATERAL (
  SELECT count(*)::integer AS stops, sum(o.delivery_fee) AS fees, min(o.delivery_type::text) AS delivery_type
  FROM job_stops js
  JOIN orders o ON o.id = js.order_id
  WHERE js.job_id = j.id
) s ON true;
--> statement-breakpoint
CREATE VIEW report_drivers AS
SELECT
  d.id AS driver_id,
  coalesce(d.name, d.username) AS driver_name,
  d.available,
  count(j.id) FILTER (WHERE j.status = 'delivered')::integer AS delivered_jobs,
  coalesce(sum(j.payout) FILTER (WHERE j.status = 'delivered'), 0) AS delivered_payout
FROM drivers d
LEFT JOIN delivery_jobs j ON j.driver_id = d.id
GROUP BY d.id;
--> statement-breakpoint
CREATE VIEW report_demand AS
SELECT created_at, description, notify_requested
FROM demand_signals;
--> statement-breakpoint
CREATE VIEW report_waitlist AS
SELECT
  w.joined_at,
  w.notified_at IS NOT NULL AS notified,
  p.title AS product_title,
  v.size,
  v.color,
  v.stock - v.reserved AS available
FROM waitlist w
JOIN product_variants v ON v.id = w.variant_id
JOIN products p ON p.id = v.product_id;
--> statement-breakpoint
-- Changing a view's owner needs the new owner to have CREATE on the schema, only for the change.
GRANT CREATE ON SCHEMA public TO app_user;
--> statement-breakpoint
ALTER VIEW report_orders OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_sales OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_stock OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_deliveries OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_drivers OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_demand OWNER TO app_user;
--> statement-breakpoint
ALTER VIEW report_waitlist OWNER TO app_user;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM app_user;
--> statement-breakpoint
-- The role that model-written queries run as: it can read the views and nothing else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'report_reader') THEN
    CREATE ROLE report_reader NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT report_reader TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO report_reader;
--> statement-breakpoint
GRANT SELECT ON report_orders, report_sales, report_stock, report_deliveries, report_drivers,
  report_demand, report_waitlist TO report_reader;
--> statement-breakpoint
-- The weekly suggestions run for shops with orders in the analysed weeks, which row-level
-- security hides before a shop is selected. This returns only shop IDs.
CREATE FUNCTION weekly_suggestion_shop_ids(p_since timestamptz)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT shop_id FROM orders WHERE created_at >= p_since
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION weekly_suggestion_shop_ids(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION weekly_suggestion_shop_ids(timestamptz) TO app_user;
