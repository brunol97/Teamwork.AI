CREATE TABLE "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"content" text NOT NULL,
	"fallback" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"base_version" integer NOT NULL,
	"uitleg" text NOT NULL,
	"proposed_content" text NOT NULL,
	"diff" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"proposed_by" text NOT NULL,
	"decided_content" text,
	"decided_by" text,
	"decided_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evaluations_task_id_idx" ON "evaluations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "evaluations_organization_id_idx" ON "evaluations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skill_proposals_skill_id_idx" ON "skill_proposals" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_proposals_organization_id_idx" ON "skill_proposals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_id_idx" ON "skill_versions" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_id_version_unique" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE INDEX "skills_organization_id_idx" ON "skills" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_organization_id_name_unique" ON "skills" USING btree ("organization_id","name");