ALTER TABLE "feeds" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
-- Hand-added (#29): a feed whose last fetch worked last succeeded then.
UPDATE "feeds" SET "last_success_at" = "last_fetched_at" WHERE "last_error" IS NULL;