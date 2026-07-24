ALTER TABLE "articles" ADD COLUMN "sanitized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "sanitizer_version" integer;