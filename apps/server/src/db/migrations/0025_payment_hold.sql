ALTER TABLE "orders" DROP COLUMN "deadline_extensions";--> statement-breakpoint
-- Payment reminders went away with the three-minute hold. A pending one would only fail.
DELETE FROM "timers" WHERE "kind" = 'order.payment_reminder' AND "status" IN ('pending', 'running');
