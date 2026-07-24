-- SPEC-016: theme becomes free-form text (a named theme id or 'auto').
ALTER TABLE "user_settings" ALTER COLUMN "theme" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "theme" SET DATA TYPE text USING "theme"::text;--> statement-breakpoint
-- Map the old light/dark/system values onto the new theme vocabulary.
UPDATE "user_settings" SET "theme" = CASE "theme"
  WHEN 'light' THEN 'daylight'
  WHEN 'dark' THEN 'midnight'
  WHEN 'system' THEN 'auto'
  ELSE 'auto'
END;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "theme" SET DEFAULT 'auto';--> statement-breakpoint
DROP TYPE "public"."theme_pref";
