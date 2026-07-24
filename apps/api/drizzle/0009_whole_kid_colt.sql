-- SPEC-016 Phase 3: add the density axis and retire the compact view mode.
ALTER TABLE "user_settings" ADD COLUMN "density" text DEFAULT 'comfortable' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "view_mode" SET DATA TYPE text USING "view_mode"::text;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_view_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_view_mode" SET DATA TYPE text USING "default_view_mode"::text;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "default_view_mode" SET DEFAULT 'cards';--> statement-breakpoint
-- Compact is a density now; existing compact selections fall back to list.
UPDATE "user_settings" SET "default_view_mode" = 'list' WHERE "default_view_mode" = 'compact';--> statement-breakpoint
UPDATE "subscriptions" SET "view_mode" = 'list' WHERE "view_mode" = 'compact';--> statement-breakpoint
DROP TYPE "public"."view_mode";
