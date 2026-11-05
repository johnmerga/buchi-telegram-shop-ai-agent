-- The nightly job forgets exact delivery pins across every shop, which row-level security blocks.
-- These functions run as their owner, clear only pins, and return how many rows they changed.
-- An order keeps its zone. Orders from before zones existed keep their pin until they get one.
CREATE FUNCTION forget_delivery_pins(p_before timestamptz)
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
      AND status IN ('delivered', 'cancelled', 'expired')
      AND updated_at < p_before
    RETURNING 1
  )
  SELECT count(*)::integer FROM forgotten
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forget_delivery_pins(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forget_delivery_pins(timestamptz) TO app_user;
--> statement-breakpoint
CREATE FUNCTION forget_pending_pins(p_before timestamptz)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH forgotten AS (
    UPDATE customers
    SET delivery_latitude = NULL, delivery_longitude = NULL, delivery_pin_at = NULL
    WHERE delivery_pin_at < p_before
    RETURNING 1
  )
  SELECT count(*)::integer FROM forgotten
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forget_pending_pins(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forget_pending_pins(timestamptz) TO app_user;
--> statement-breakpoint
-- The nightly job learns each shop's acceptance factors. This returns only the IDs of shops with
-- far-area quotes that a driver held.
CREATE FUNCTION far_quote_shop_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT shop_id FROM far_quotes WHERE held_price IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION far_quote_shop_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION far_quote_shop_ids() TO app_user;
