CREATE TABLE "human_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"asked_user_id" text NOT NULL,
	"question" text NOT NULL,
	"reason" text NOT NULL,
	"options" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "human_tasks_task_id_idx" ON "human_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "human_tasks_organization_id_idx" ON "human_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "human_tasks_asked_user_id_idx" ON "human_tasks" USING btree ("asked_user_id");