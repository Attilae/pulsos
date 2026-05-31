ALTER TABLE "presets" ADD COLUMN "share_id" text;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_share_id_unique" UNIQUE("share_id");