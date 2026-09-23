-- default_article_view becomes free-form text so it can hold 'auto' (pick Feed
-- or Extracted per article). Drop the enum default first; it cannot be cast.
ALTER TABLE "user_settings" ALTER COLUMN "default_article_view" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_article_view" SET DATA TYPE text USING "default_article_view"::text;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_article_view" SET DEFAULT 'auto';--> statement-breakpoint
-- 'simplified' was the old default and the only way to get extraction at all;
-- auto keeps extraction for summary-only items and uses the feed otherwise.
UPDATE "user_settings" SET "default_article_view" = 'auto' WHERE "default_article_view" = 'simplified';--> statement-breakpoint
DROP TYPE "public"."article_view";
