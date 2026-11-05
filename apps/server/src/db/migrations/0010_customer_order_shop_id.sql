-- A button in a customer's chat carries only the order ID. Before any shop is selected, row-level
-- security hides the order, so this function returns its shop ID, and only to the customer who
-- placed it.
CREATE FUNCTION customer_order_shop_id(p_order_id uuid, p_telegram_user_id bigint)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.shop_id
  FROM orders o
  JOIN customers c ON c.id = o.customer_id AND c.shop_id = o.shop_id
  WHERE o.id = p_order_id AND c.telegram_user_id = p_telegram_user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customer_order_shop_id(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customer_order_shop_id(uuid, bigint) TO app_user;
