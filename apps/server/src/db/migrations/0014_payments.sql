CREATE TYPE "public"."bank_check" AS ENUM('CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."owner_payment_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_decision" AS ENUM('approve', 'reject', 'review', 'ask_difference', 'ask_clearer');--> statement-breakpoint
CREATE TYPE "public"."risk_signal_kind" AS ENUM('receipt_rejected', 'bank_mismatch', 'owner_rejected');--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"telegram_file_id" text NOT NULL,
	"extraction" jsonb,
	"provider" "payment_provider",
	"tx_ref" text,
	"amount" numeric(12, 2),
	"rules" jsonb,
	"bank_check" "bank_check",
	"decision" "payment_decision" NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"owner_decision" "owner_payment_decision",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"tx_ref" text NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refs_provider_tx_ref_unique" UNIQUE("provider","tx_ref")
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer_hash" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" "risk_signal_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_order_id_shop_id_orders_id_shop_id_fk" FOREIGN KEY ("order_id","shop_id") REFERENCES "public"."orders"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refs" ADD CONSTRAINT "payment_refs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_proofs_order_idx" ON "payment_proofs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "risk_signals_payer_hash_idx" ON "risk_signals" USING btree ("payer_hash");--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "payment_proofs" AS PERMISSIVE FOR ALL TO "app_user" USING ("payment_proofs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("payment_proofs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);