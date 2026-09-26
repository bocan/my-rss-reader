ALTER TABLE "user_settings" ADD COLUMN "reading_size" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reading_width" text DEFAULT 'normal' NOT NULL;