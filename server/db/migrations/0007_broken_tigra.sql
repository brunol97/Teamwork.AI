CREATE TABLE "document_section_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"section_title" text NOT NULL,
	"assignee_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overdracht_notities" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'pauze' NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"finalized_event_id" text,
	"finalized_at" bigint,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "document_section_assignments_task_id_idx" ON "document_section_assignments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "document_section_assignments_organization_id_idx" ON "document_section_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_section_assignments_task_title_unique" ON "document_section_assignments" USING btree ("task_id","section_title");--> statement-breakpoint
CREATE INDEX "overdracht_notities_task_id_idx" ON "overdracht_notities" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "overdracht_notities_organization_id_idx" ON "overdracht_notities" USING btree ("organization_id");