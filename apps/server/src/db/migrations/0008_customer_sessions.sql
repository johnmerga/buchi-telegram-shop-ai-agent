CREATE TABLE "customer_sessions" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"pending_variant_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_pending_variant_id_product_variants_id_fk" FOREIGN KEY ("pending_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;