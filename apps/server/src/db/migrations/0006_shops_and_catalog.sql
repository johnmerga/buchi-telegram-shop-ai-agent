CREATE TYPE "public"."pricing_mode" AS ENUM('fixed', 'negotiable');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('telebirr', 'cbe_birr', 'cbe_bank');--> statement-breakpoint
CREATE TABLE "channel_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer,
	"taps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"size" text NOT NULL,
	"color" text,
	"stock" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_variants_option_unique" UNIQUE NULLS NOT DISTINCT("product_id","size","color"),
	CONSTRAINT "product_variants_stock_covers_reserved" CHECK ("product_variants"."reserved" >= 0 and "product_variants"."reserved" <= "product_variants"."stock")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"lowest_price" numeric(12, 2),
	"photo_file_ids" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "products_lowest_price_matches_mode" CHECK (("products"."pricing_mode" = 'fixed' and "products"."lowest_price" is null)
        or ("products"."pricing_mode" = 'negotiable' and "products"."lowest_price" is not null and "products"."lowest_price" <= "products"."price"))
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "channel_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "channel_title" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_shop_id_products_id_shop_id_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_channel_chat_id_unique" UNIQUE("channel_chat_id");--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "channel_posts" AS PERMISSIVE FOR ALL TO "app_user" USING ("channel_posts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("channel_posts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "product_variants" AS PERMISSIVE FOR ALL TO "app_user" USING ("product_variants"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("product_variants"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "products" AS PERMISSIVE FOR ALL TO "app_user" USING ("products"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("products"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "payment_accounts" AS PERMISSIVE FOR ALL TO "app_user" USING ("payment_accounts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("payment_accounts"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);