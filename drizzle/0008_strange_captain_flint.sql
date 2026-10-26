CREATE TABLE "rate_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_counters_expires_idx" ON "rate_counters" USING btree ("expires_at");