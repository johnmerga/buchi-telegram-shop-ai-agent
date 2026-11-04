CREATE TYPE "public"."telegram_update_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "telegram_update_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "telegram_updates_status_idx" ON "telegram_updates" USING btree ("status","update_id");