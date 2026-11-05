CREATE TYPE "public"."daily_report_kind" AS ENUM('evening_summary', 'morning_brief');--> statement-breakpoint
CREATE TYPE "public"."ledger_row_status" AS ENUM('pending', 'sent');--> statement-breakpoint
CREATE TYPE "public"."ledger_tab" AS ENUM('Sales', 'Daily');--> statement-breakpoint
CREATE TABLE "daily_report_runs" (
	"shop_id" uuid NOT NULL,
	"kind" "daily_report_kind" NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_report_runs_shop_id_kind_day_pk" PRIMARY KEY("shop_id","kind","day")
);
--> statement-breakpoint
ALTER TABLE "daily_report_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tab" "ledger_tab" NOT NULL,
	"cells" jsonb NOT NULL,
	"status" "ledger_row_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_rows_shop_key_unique" UNIQUE("shop_id","key")
);
--> statement-breakpoint
ALTER TABLE "ledger_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sheet_ledgers" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sheet_ledgers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_report_runs" ADD CONSTRAINT "daily_report_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rows" ADD CONSTRAINT "ledger_rows_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_ledgers" ADD CONSTRAINT "sheet_ledgers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_rows_due_idx" ON "ledger_rows" USING btree ("status","next_attempt_at") WHERE "ledger_rows"."status" = 'pending';--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "daily_report_runs" AS PERMISSIVE FOR ALL TO "app_user" USING ("daily_report_runs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("daily_report_runs"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "ledger_rows" AS PERMISSIVE FOR ALL TO "app_user" USING ("ledger_rows"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("ledger_rows"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "shop_isolation" ON "sheet_ledgers" AS PERMISSIVE FOR ALL TO "app_user" USING ("sheet_ledgers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid) WITH CHECK ("sheet_ledgers"."shop_id" = nullif(current_setting('app.shop_id', true), '')::uuid);--> statement-breakpoint
-- The daily jobs report on every shop, which row-level security blocks. This returns only IDs.
CREATE FUNCTION report_shop_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM shops
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION report_shop_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION report_shop_ids() TO app_user;
--> statement-breakpoint
-- The tick sends due ledger rows of every shop with a spreadsheet. This returns only shop IDs.
CREATE FUNCTION ledger_due_shop_ids(p_now timestamptz)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT r.shop_id FROM ledger_rows r JOIN sheet_ledgers s ON s.shop_id = r.shop_id
  WHERE r.status = 'pending' AND r.next_attempt_at <= p_now
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ledger_due_shop_ids(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ledger_due_shop_ids(timestamptz) TO app_user;
