CREATE TABLE "reply_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"replied_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reply_times" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reply_times" ADD CONSTRAINT "reply_times_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_times_shop_received_idx" ON "reply_times" USING btree ("shop_id","received_at");--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "reply_times" AS PERMISSIVE FOR ALL TO "app_user" USING ("reply_times"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("reply_times"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);