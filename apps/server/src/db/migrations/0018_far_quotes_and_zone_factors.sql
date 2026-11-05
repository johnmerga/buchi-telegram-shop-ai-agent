CREATE TYPE "public"."time_band" AS ENUM('peak', 'off_peak');--> statement-breakpoint
CREATE TYPE "public"."far_quote_source" AS ENUM('agent', 'statistics');--> statement-breakpoint
CREATE TYPE "public"."far_quote_status" AS ENUM('estimating', 'awaiting_owner', 'offered', 'held', 'accepted', 'declined', 'expired', 'pickup');--> statement-breakpoint
CREATE TABLE "area_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"zone" text NOT NULL,
	"note" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "area_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone" text NOT NULL,
	"band" time_band NOT NULL,
	"routing_seconds" integer NOT NULL,
	"expected_seconds" integer NOT NULL,
	"actual_seconds" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trip_legs_positive_seconds" CHECK ("trip_legs"."routing_seconds" > 0 and "trip_legs"."actual_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "zone_time_factors" (
	"zone" text NOT NULL,
	"band" time_band NOT NULL,
	"factor" double precision NOT NULL,
	"trips" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_time_factors_zone_band_pk" PRIMARY KEY("zone","band")
);
--> statement-breakpoint
CREATE TABLE "far_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid,
	"zone" text NOT NULL,
	"route_meters" integer NOT NULL,
	"routing_seconds" integer NOT NULL,
	"expected_seconds" integer NOT NULL,
	"formula_payout" numeric(12, 2) NOT NULL,
	"cap" numeric(12, 2) NOT NULL,
	"status" "far_quote_status" DEFAULT 'estimating' NOT NULL,
	"proposed_price" numeric(12, 2),
	"source" "far_quote_source",
	"decision_id" uuid,
	"held_price" numeric(12, 2),
	"raises" integer DEFAULT 0 NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "far_quotes_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "far_quotes_order_unless_synthetic" CHECK ("far_quotes"."synthetic" or "far_quotes"."order_id" is not null),
	CONSTRAINT "far_quotes_priced" CHECK (("far_quotes"."status" = 'estimating') = ("far_quotes"."proposed_price" is null) and ("far_quotes"."proposed_price" is null) = ("far_quotes"."source" is null))
);
--> statement-breakpoint
ALTER TABLE "far_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "zone_acceptance_factors" (
	"shop_id" uuid NOT NULL,
	"zone" text NOT NULL,
	"factor" double precision NOT NULL,
	"trips" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_acceptance_factors_shop_id_zone_pk" PRIMARY KEY("shop_id","zone")
);
--> statement-breakpoint
ALTER TABLE "zone_acceptance_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_delivery_pin_complete";--> statement-breakpoint
ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_taken_by";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_delivery_pin";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_pin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "special" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "routing_seconds" integer;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "expected_seconds" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone" text;--> statement-breakpoint
ALTER TABLE "area_notes" ADD CONSTRAINT "area_notes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "far_quotes" ADD CONSTRAINT "far_quotes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "far_quotes" ADD CONSTRAINT "far_quotes_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "far_quotes" ADD CONSTRAINT "far_quotes_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_acceptance_factors" ADD CONSTRAINT "zone_acceptance_factors_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_notes_zone_idx" ON "area_notes" USING btree ("shop_id","zone");--> statement-breakpoint
CREATE INDEX "trip_legs_started_at_idx" ON "trip_legs" USING btree ("started_at");--> statement-breakpoint
UPDATE "customers" SET "delivery_pin_at" = now() WHERE "delivery_latitude" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_delivery_pin_complete" CHECK (("customers"."delivery_latitude" is null) = ("customers"."delivery_longitude" is null) and ("customers"."delivery_latitude" is null) = ("customers"."delivery_pin_at" is null));--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_taken_by" CHECK (("job_offers"."status" in ('taken', 'held')) = ("job_offers"."taken_by_driver_id" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_pin" CHECK (("orders"."delivery_latitude" is null) = ("orders"."delivery_longitude" is null) and ("orders"."delivery_type" = 'pickup') = ("orders"."delivery_latitude" is null and "orders"."delivery_zone" is null));--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "area_notes" AS PERMISSIVE FOR ALL TO "app_user" USING ("area_notes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("area_notes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "far_quotes" AS PERMISSIVE FOR ALL TO "app_user" USING ("far_quotes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("far_quotes"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "zone_acceptance_factors" AS PERMISSIVE FOR ALL TO "app_user" USING ("zone_acceptance_factors"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("zone_acceptance_factors"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);