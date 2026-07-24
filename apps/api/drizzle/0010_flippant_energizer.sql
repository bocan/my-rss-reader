-- SPEC-018: per-feed interval override (nullable => inherit app default),
-- app-wide default poll interval, and subscription article-view + hide-from-all.
ALTER TABLE "feeds" ALTER COLUMN "fetch_interval_sec" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "feeds" ALTER COLUMN "fetch_interval_sec" DROP NOT NULL;--> statement-breakpoint
-- Existing rows all hold the never-user-set 900; null them so they inherit.
UPDATE "feeds" SET "fetch_interval_sec" = NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_poll_interval_sec" integer DEFAULT 900 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "article_view" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "hide_from_all" boolean DEFAULT false NOT NULL;
