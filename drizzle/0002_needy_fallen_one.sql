CREATE TABLE "compositions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"city_id" text,
	"bpm" integer DEFAULT 120 NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compositions_user_updated_idx" ON "compositions" USING btree ("user_id","updated_at");