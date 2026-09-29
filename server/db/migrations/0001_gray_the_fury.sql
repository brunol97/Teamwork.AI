CREATE TABLE "task_followers" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"token" text NOT NULL,
	"invited_email" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"accepted_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "task_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "task_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text DEFAULT 'melding' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_presence" (
	"client_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_documents" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "task_followers_task_id_idx" ON "task_followers" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_followers_task_id_user_id_unique" ON "task_followers" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE INDEX "task_invites_task_id_idx" ON "task_invites" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_invites_organization_id_idx" ON "task_invites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "task_notifications_recipient_id_idx" ON "task_notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "task_notifications_task_id_idx" ON "task_notifications" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_presence_task_id_idx" ON "task_presence" USING btree ("task_id");