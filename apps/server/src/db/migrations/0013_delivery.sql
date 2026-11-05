CREATE TABLE "delivery_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"base_fee" numeric(12, 2) NOT NULL,
	"rate_per_km" numeric(12, 2) NOT NULL,
	"rate_per_minute" numeric(12, 2) NOT NULL,
	"free_radius_km" double precision NOT NULL,
	"standard_range_km" double precision NOT NULL,
	"far_range_km" double precision NOT NULL,
	"far_cap" numeric(12, 2) NOT NULL,
	"saver_discount_percent" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_settings_ranges_grow" CHECK (0 <= "delivery_settings"."free_radius_km" and "delivery_settings"."free_radius_km" <= "delivery_settings"."standard_range_km" and "delivery_settings"."standard_range_km" <= "delivery_settings"."far_range_km"),
	CONSTRAINT "delivery_settings_saver_discount" CHECK ("delivery_settings"."saver_discount_percent" between 0 and 90)
);
--> statement-breakpoint
ALTER TABLE "delivery_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "landmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"confirmations" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landmarks_shop_name_area_unique" UNIQUE("shop_id","name","area")
);
--> statement-breakpoint
ALTER TABLE "landmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_latitude" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_longitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_latitude" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_longitude" double precision;--> statement-breakpoint
ALTER TABLE "delivery_settings" ADD CONSTRAINT "delivery_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_delivery_pin_complete" CHECK (("customers"."delivery_latitude" is null) = ("customers"."delivery_longitude" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_pin" CHECK (("orders"."delivery_latitude" is null) = ("orders"."delivery_longitude" is null) and ("orders"."delivery_type" = 'pickup') = ("orders"."delivery_latitude" is null));--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "delivery_settings" AS PERMISSIVE FOR ALL TO "app_user" USING ("delivery_settings"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("delivery_settings"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "landmarks" AS PERMISSIVE FOR ALL TO "app_user" USING ("landmarks"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("landmarks"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);