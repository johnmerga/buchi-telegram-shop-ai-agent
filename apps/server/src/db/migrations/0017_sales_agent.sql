CREATE TABLE "customer_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fact" text NOT NULL,
	"source_message" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_facts_customer_key_unique" UNIQUE("customer_id","key")
);
--> statement-breakpoint
ALTER TABLE "customer_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demand_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"description" text NOT NULL,
	"notify_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demand_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "waitlist_variant_customer_unique" UNIQUE("variant_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "waitlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"agreed_price" numeric(12, 2) NOT NULL,
	"concessions_made" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiations_customer_product_unique" UNIQUE("customer_id","product_id"),
	CONSTRAINT "negotiations_concessions_not_negative" CHECK ("negotiations"."concessions_made" >= 0)
);
--> statement-breakpoint
ALTER TABLE "negotiations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "recent_turns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_variant_id_shop_id_product_variants_id_shop_id_fk" FOREIGN KEY ("variant_id","shop_id") REFERENCES "public"."product_variants"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "customer_facts" AS PERMISSIVE FOR ALL TO "app_user" USING ("customer_facts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("customer_facts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "demand_signals" AS PERMISSIVE FOR ALL TO "app_user" USING ("demand_signals"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("demand_signals"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "waitlist" AS PERMISSIVE FOR ALL TO "app_user" USING ("waitlist"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("waitlist"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "negotiations" AS PERMISSIVE FOR ALL TO "app_user" USING ("negotiations"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("negotiations"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);