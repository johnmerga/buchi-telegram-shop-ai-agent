-- Actor resolution needs the shops a Telegram user owns before any shop is selected, which
-- row-level security blocks. This function runs as its owner and returns only shop IDs.
CREATE FUNCTION owner_shop_ids(p_telegram_user_id bigint)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM shop_members WHERE telegram_user_id = p_telegram_user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION owner_shop_ids(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION owner_shop_ids(bigint) TO app_user;
