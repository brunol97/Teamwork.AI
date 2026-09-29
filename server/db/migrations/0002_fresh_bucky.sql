ALTER TABLE "task_presence" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "task_presence" SET "organization_id" = "projects"."organization_id" FROM "tasks", "projects" WHERE "task_presence"."task_id" = "tasks"."id" AND "tasks"."project_id" = "projects"."id";--> statement-breakpoint
DELETE FROM "task_presence" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "task_presence" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "task_presence_organization_id_idx" ON "task_presence" USING btree ("organization_id");
