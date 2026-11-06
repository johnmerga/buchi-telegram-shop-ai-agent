ALTER TABLE "delivery_jobs" ADD COLUMN "live_latitude" double precision;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "live_longitude" double precision;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "live_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "live_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "live_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "job_stops" ADD COLUMN "live_message_id" integer;