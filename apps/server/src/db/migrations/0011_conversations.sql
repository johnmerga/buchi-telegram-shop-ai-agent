CREATE TYPE "public"."conversation_mode" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_telegram_user_id" bigint NOT NULL,
	"customer_name" text NOT NULL,
	"mode" "conversation_mode" DEFAULT 'agent' NOT NULL,
	"hand_back_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_shop_customer_unique" UNIQUE("shop_id","customer_telegram_user_id"),
	CONSTRAINT "conversations_id_shop_unique" UNIQUE("id","shop_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relayed_messages" (
	"owner_chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"shop_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relayed_messages_owner_chat_id_message_id_pk" PRIMARY KEY("owner_chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "relayed_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relayed_messages" ADD CONSTRAINT "relayed_messages_conversation_id_shop_id_conversations_id_shop_id_fk" FOREIGN KEY ("conversation_id","shop_id") REFERENCES "public"."conversations"("id","shop_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "conversations" AS PERMISSIVE FOR ALL TO "app_user" USING ("conversations"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("conversations"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "relayed_messages" AS PERMISSIVE FOR ALL TO "app_user" USING ("relayed_messages"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("relayed_messages"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);