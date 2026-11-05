CREATE TYPE "public"."agent_decision_result" AS ENUM('accepted', 'rejected', 'needs_owner');--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('sales', 'operations', 'owner_assistant');--> statement-breakpoint
CREATE TYPE "public"."agent_trace_outcome" AS ENUM('reply', 'tool_calls', 'escalated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('fast', 'smart');--> statement-breakpoint
CREATE TYPE "public"."owner_confirmation_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent" "agent_name" NOT NULL,
	"tool" text NOT NULL,
	"proposed" jsonb NOT NULL,
	"limits" jsonb,
	"result" "agent_decision_result" NOT NULL,
	"reason" text NOT NULL,
	"counteroffer" jsonb,
	"agent_reason" text,
	"evidence_ids" text[] DEFAULT '{}' NOT NULL,
	"owner_status" "owner_confirmation_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_decisions_owner_status_iff_needs_owner" CHECK (("agent_decisions"."result" = 'needs_owner') = ("agent_decisions"."owner_status" is not null)),
	CONSTRAINT "agent_decisions_counteroffer_iff_rejected" CHECK (("agent_decisions"."result" = 'rejected') = ("agent_decisions"."counteroffer" is not null))
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"agent" "agent_name" NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"model_tier" "model_tier" NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"outcome" "agent_trace_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_traces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "agent_decisions" AS PERMISSIVE FOR ALL TO "app_user" USING ("agent_decisions"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("agent_decisions"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "agent_traces" AS PERMISSIVE FOR ALL TO "app_user" USING ("agent_traces"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("agent_traces"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);