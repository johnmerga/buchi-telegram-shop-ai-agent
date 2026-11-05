-- A Buy link carries only the channel post ID. Before any shop is selected, row-level security
-- hides the post, so this function returns the post's shop ID and nothing else.
CREATE FUNCTION channel_post_shop_id(p_post_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shop_id FROM channel_posts WHERE id = p_post_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION channel_post_shop_id(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION channel_post_shop_id(uuid) TO app_user;
