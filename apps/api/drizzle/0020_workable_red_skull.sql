ALTER TABLE "folders" ADD COLUMN "sort_order" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "sort_order" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_sort_order" text DEFAULT 'newest' NOT NULL;