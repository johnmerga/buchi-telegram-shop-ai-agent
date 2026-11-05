CREATE TYPE "public"."delivery_job_status" AS ENUM('offered', 'assigned', 'picked_up', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."delivery_receipt" AS ENUM('received', 'problem', 'assumed');--> statement-breakpoint
CREATE TYPE "public"."job_offer_status" AS ENUM('open', 'held', 'taken', 'expired');--> statement-breakpoint
ALTER TYPE "public"."order_actor" ADD VALUE 'driver' BEFORE 'agent';--> statement-breakpoint
CREATE TABLE "delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"driver_id" uuid,
	"status" "delivery_job_status" DEFAULT 'offered' NOT NULL,
	"payout" numeric(12, 2) NOT NULL,
	"separate_trips_payout" numeric(12, 2) NOT NULL,
	"route_meters" integer NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"actual_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "delivery_jobs_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "delivery_jobs_driver_assigned" CHECK (("delivery_jobs"."status" = 'offered') = ("delivery_jobs"."driver_id" is null))
);
--> statement-breakpoint
ALTER TABLE "delivery_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"username" text NOT NULL,
	"telegram_user_id" bigint,
	"name" text,
	"phone" text,
	"available" boolean DEFAULT false NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_invite_token_hash_unique" UNIQUE("invite_token_hash"),
	CONSTRAINT "drivers_shop_username_unique" UNIQUE("shop_id","username"),
	CONSTRAINT "drivers_shop_telegram_unique" UNIQUE("shop_id","telegram_user_id"),
	CONSTRAINT "drivers_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "drivers_invite_complete" CHECK (("drivers"."invite_token_hash" is null) = ("drivers"."invite_expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"raise_step" integer DEFAULT 0 NOT NULL,
	"status" "job_offer_status" DEFAULT 'open' NOT NULL,
	"taken_by_driver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offers_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "job_offers_job_step_unique" UNIQUE("job_id","raise_step"),
	CONSTRAINT "job_offers_taken_by" CHECK (("job_offers"."status" = 'taken') = ("job_offers"."taken_by_driver_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "job_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"location_requested_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"meters_from_pin" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"receipt" "delivery_receipt",
	"receipt_at" timestamp with time zone,
	CONSTRAINT "job_stops_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "job_stops_job_position_unique" UNIQUE("job_id","position")
);
--> statement-breakpoint
ALTER TABLE "job_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offer_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_settings" ADD COLUMN "saver_run_times" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_settings" ADD COLUMN "next_saver_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_driver_id_shop_id_drivers_id_shop_id_fk" FOREIGN KEY ("driver_id","shop_id") REFERENCES "public"."drivers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_job_id_shop_id_delivery_jobs_id_shop_id_fk" FOREIGN KEY ("job_id","shop_id") REFERENCES "public"."delivery_jobs"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_taken_by_driver_id_shop_id_drivers_id_shop_id_fk" FOREIGN KEY ("taken_by_driver_id","shop_id") REFERENCES "public"."drivers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stops" ADD CONSTRAINT "job_stops_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stops" ADD CONSTRAINT "job_stops_job_id_shop_id_delivery_jobs_id_shop_id_fk" FOREIGN KEY ("job_id","shop_id") REFERENCES "public"."delivery_jobs"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stops" ADD CONSTRAINT "job_stops_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_messages" ADD CONSTRAINT "offer_messages_offer_id_shop_id_job_offers_id_shop_id_fk" FOREIGN KEY ("offer_id","shop_id") REFERENCES "public"."job_offers"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_messages_offer_idx" ON "offer_messages" USING btree ("offer_id");--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "delivery_jobs" AS PERMISSIVE FOR ALL TO "app_user" USING ("delivery_jobs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("delivery_jobs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "drivers" AS PERMISSIVE FOR ALL TO "app_user" USING ("drivers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("drivers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "job_offers" AS PERMISSIVE FOR ALL TO "app_user" USING ("job_offers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("job_offers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "job_stops" AS PERMISSIVE FOR ALL TO "app_user" USING ("job_stops"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("job_stops"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "offer_messages" AS PERMISSIVE FOR ALL TO "app_user" USING ("offer_messages"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("offer_messages"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);