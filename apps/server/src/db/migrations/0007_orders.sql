CREATE TYPE "public"."delivery_type" AS ENUM('free', 'express', 'saver', 'far', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."order_actor" AS ENUM('customer', 'owner', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('quoting', 'awaiting_payment', 'verifying', 'paid', 'needs_review', 'dispatching', 'assigned', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_shop_telegram_unique" UNIQUE("shop_id","telegram_user_id"),
	CONSTRAINT "customers_id_shop_unique" UNIQUE("id","shop_id")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor" "order_actor" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"delivery_type" "delivery_type" NOT NULL,
	"items_total" numeric(12, 2) NOT NULL,
	"delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "orders_total_adds_up" CHECK ("orders"."total" = "orders"."items_total" + "orders"."delivery_fee")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_shop_id_product_variants_id_shop_id_fk" FOREIGN KEY ("variant_id","shop_id") REFERENCES "public"."product_variants"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "app_user" USING ("customers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("customers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "order_events" AS PERMISSIVE FOR ALL TO "app_user" USING ("order_events"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("order_events"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO "app_user" USING ("order_items"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("order_items"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "orders" AS PERMISSIVE FOR ALL TO "app_user" USING ("orders"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("orders"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);