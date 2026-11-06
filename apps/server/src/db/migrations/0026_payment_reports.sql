ALTER TYPE "public"."order_status" ADD VALUE 'payment_rejected';--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
-- A payment-rejected order is closed too, so the nightly job forgets its pin. The status is
-- compared as text, because an enum value added in this transaction cannot be used yet.
CREATE OR REPLACE FUNCTION forget_delivery_pins(p_before timestamptz)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH forgotten AS (
    UPDATE orders SET delivery_latitude = NULL, delivery_longitude = NULL
    WHERE delivery_latitude IS NOT NULL
      AND delivery_zone IS NOT NULL
      AND status::text IN ('delivered', 'cancelled', 'expired', 'payment_rejected')
      AND updated_at < p_before
    RETURNING 1
  )
  SELECT count(*)::integer FROM forgotten
$$;
