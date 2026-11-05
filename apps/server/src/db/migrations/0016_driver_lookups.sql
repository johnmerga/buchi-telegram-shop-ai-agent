-- Actor resolution needs the shops a Telegram user drives for before any shop is selected, which
-- row-level security blocks. This function runs as its owner and returns only shop IDs.
CREATE FUNCTION driver_shop_ids(p_telegram_user_id bigint)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM drivers WHERE telegram_user_id = p_telegram_user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION driver_shop_ids(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION driver_shop_ids(bigint) TO app_user;
--> statement-breakpoint
-- An invite link carries only its token. This returns the shop of a pending invite, and only to
-- someone who holds the token, because the table stores just its hash.
CREATE FUNCTION driver_invite_shop_id(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM drivers WHERE invite_token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION driver_invite_shop_id(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION driver_invite_shop_id(text) TO app_user;
--> statement-breakpoint
-- The Saver run job starts outside any shop. This returns only the IDs of shops with paid orders
-- of one delivery type waiting for dispatch.
CREATE FUNCTION paid_order_shop_ids(p_delivery_type delivery_type)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT shop_id FROM orders WHERE status = 'paid' AND delivery_type = p_delivery_type
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION paid_order_shop_ids(delivery_type) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION paid_order_shop_ids(delivery_type) TO app_user;
