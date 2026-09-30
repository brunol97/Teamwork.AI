CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"model" text,
	"tools" text DEFAULT '[]' NOT NULL,
	"skills" text DEFAULT '[]' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"template" text,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agents_organization_id_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_organization_id_name_unique" ON "agents" USING btree ("organization_id","name");