ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "remote_kind" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "remote_agent_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "remote_endpoint" text;
