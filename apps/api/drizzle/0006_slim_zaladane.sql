CREATE TYPE "public"."article_view" AS ENUM('simplified', 'readable', 'web');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TYPE "public"."view_mode" AS ENUM('cards', 'list', 'magazine', 'compact');--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme_pref" DEFAULT 'system' NOT NULL,
	"default_view_mode" "view_mode" DEFAULT 'cards' NOT NULL,
	"default_article_view" "article_view" DEFAULT 'simplified' NOT NULL,
	"mark_read_on_scroll" boolean DEFAULT false NOT NULL,
	"show_unread_only" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "view_mode" "view_mode";--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;