ALTER TABLE "feeds" ADD COLUMN "websub_hub_url" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "websub_topic_url" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "websub_secret" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "websub_callback_token" text;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "websub_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "websub_state" text DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_websub_callback_token_key" ON "feeds" USING btree ("websub_callback_token");