CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text,
	"bio" text,
	"visibility" text DEFAULT 'off' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_states" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "article_states" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_states" ADD COLUMN "share_note" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_slug_key" ON "profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "article_states_shared_idx" ON "article_states" USING btree ("user_id","shared_at") WHERE "article_states"."shared" = true;