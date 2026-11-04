CREATE TABLE "shop_members" (
	"shop_id" uuid NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_members_shop_id_telegram_user_id_pk" PRIMARY KEY("shop_id","telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "shop_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "shop_members" AS PERMISSIVE FOR ALL TO "app_user" USING ("shop_members"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("shop_members"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "shops" AS PERMISSIVE FOR ALL TO "app_user" USING ("shops"."id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("shops"."id" = nullif(current_setting('app.shop_id', true), '')::uuid);