CREATE TABLE "reference_loops" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"pathname" text NOT NULL,
	"url" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_sec" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reference_loops_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "reference_loops" ADD CONSTRAINT "reference_loops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;