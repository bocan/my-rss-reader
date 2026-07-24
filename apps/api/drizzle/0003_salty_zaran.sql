ALTER TABLE "articles" ADD COLUMN "readable_html" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "readable_fetched_at" timestamp with time zone;