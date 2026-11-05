CREATE TYPE "public"."area_note_source" AS ENUM('driver', 'owner');--> statement-breakpoint
CREATE TYPE "public"."delivery_problem_kind" AS ENUM('wrong_size', 'damaged', 'other');--> statement-breakpoint
CREATE TABLE "area_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"zone" text NOT NULL,
	"note" text NOT NULL,
	"source" "area_note_source" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "area_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "delivery_problem_kind" NOT NULL,
	"wanted_size" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_problems_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "delivery_problems" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_variant_id" uuid NOT NULL,
	"to_variant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_exchanges_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "order_exchanges_other_size" CHECK ("order_exchanges"."from_variant_id" <> "order_exchanges"."to_variant_id")
);
--> statement-breakpoint
ALTER TABLE "order_exchanges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD COLUMN "decided_by" bigint;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deadline_extensions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "area_notes" ADD CONSTRAINT "area_notes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problems" ADD CONSTRAINT "delivery_problems_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problems" ADD CONSTRAINT "delivery_problems_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_exchanges" ADD CONSTRAINT "order_exchanges_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_exchanges" ADD CONSTRAINT "order_exchanges_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_exchanges" ADD CONSTRAINT "order_exchanges_from_variant_id_shop_id_product_variants_id_shop_id_fk" FOREIGN KEY ("from_variant_id","shop_id") REFERENCES "public"."product_variants"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_exchanges" ADD CONSTRAINT "order_exchanges_to_variant_id_shop_id_product_variants_id_shop_id_fk" FOREIGN KEY ("to_variant_id","shop_id") REFERENCES "public"."product_variants"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_notes_zone_idx" ON "area_notes" USING btree ("shop_id","zone","expires_at");--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_decided_iff_answered" CHECK (("agent_decisions"."owner_status" in ('approved', 'declined')) = ("agent_decisions"."decided_at" is not null and "agent_decisions"."decided_by" is not null));--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "area_notes" AS PERMISSIVE FOR ALL TO "app_user" USING ("area_notes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("area_notes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "delivery_problems" AS PERMISSIVE FOR ALL TO "app_user" USING ("delivery_problems"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("delivery_problems"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "order_exchanges" AS PERMISSIVE FOR ALL TO "app_user" USING ("order_exchanges"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("order_exchanges"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);