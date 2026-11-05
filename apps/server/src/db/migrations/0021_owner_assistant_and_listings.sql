CREATE TYPE "public"."listing_draft_status" AS ENUM('draft', 'posted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."stock_hold_status" AS ENUM('held', 'used', 'released');--> statement-breakpoint
CREATE TYPE "public"."owner_rule_type" AS ENUM('delivery_pause', 'promotion', 'delivery_settings');--> statement-breakpoint
CREATE TABLE "weekly_suggestion_runs" (
	"shop_id" uuid NOT NULL,
	"week" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_suggestion_runs_shop_id_week_pk" PRIMARY KEY("shop_id","week")
);
--> statement-breakpoint
ALTER TABLE "weekly_suggestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"owner_text" text NOT NULL,
	"photo_file_ids" text[] NOT NULL,
	"media_group_id" text,
	"draft" jsonb NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"price" numeric(12, 2),
	"lowest_price" numeric(12, 2),
	"stock_per_size" integer NOT NULL,
	"status" "listing_draft_status" DEFAULT 'draft' NOT NULL,
	"preview_chat_id" bigint,
	"preview_message_id" integer,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_drafts_prices_match_mode" CHECK (("listing_drafts"."pricing_mode" = 'fixed' and "listing_drafts"."lowest_price" is null)
        or ("listing_drafts"."pricing_mode" = 'negotiable' and ("listing_drafts"."lowest_price" is null) = ("listing_drafts"."price" is null))),
	CONSTRAINT "listing_drafts_stock_positive" CHECK ("listing_drafts"."stock_per_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "listing_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "stock_hold_status" DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"type" "owner_rule_type" NOT NULL,
	"parameters" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"confirmed_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_rules_period" CHECK ("owner_rules"."ends_at" is null or "owner_rules"."ends_at" > "owner_rules"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "owner_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "demand_signals" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_suggestion_runs" ADD CONSTRAINT "weekly_suggestion_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_variant_id_shop_id_product_variants_id_shop_id_fk" FOREIGN KEY ("variant_id","shop_id") REFERENCES "public"."product_variants"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_customer_id_shop_id_customers_id_shop_id_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_rules" ADD CONSTRAINT "owner_rules_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_holds_customer_variant_idx" ON "stock_holds" USING btree ("customer_id","variant_id","status");--> statement-breakpoint
CREATE INDEX "owner_rules_active_idx" ON "owner_rules" USING btree ("shop_id","type","starts_at");--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "weekly_suggestion_runs" AS PERMISSIVE FOR ALL TO "app_user" USING ("weekly_suggestion_runs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("weekly_suggestion_runs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "listing_drafts" AS PERMISSIVE FOR ALL TO "app_user" USING ("listing_drafts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("listing_drafts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "stock_holds" AS PERMISSIVE FOR ALL TO "app_user" USING ("stock_holds"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("stock_holds"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "owner_rules" AS PERMISSIVE FOR ALL TO "app_user" USING ("owner_rules"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("owner_rules"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);