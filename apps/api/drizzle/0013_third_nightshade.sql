ALTER TABLE "profiles" ADD COLUMN "blogroll_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "in_blogroll" boolean DEFAULT true NOT NULL;