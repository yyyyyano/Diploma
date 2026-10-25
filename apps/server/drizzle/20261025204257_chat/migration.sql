CREATE TABLE "chat_conversations" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text,
	CONSTRAINT "chat_conversations_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	CONSTRAINT "chat_messages_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "chat_messages_role_check" CHECK ("role" in ('user', 'assistant')),
	CONSTRAINT "chat_messages_status_check" CHECK ("status" in ('streaming', 'complete', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_id_fk_idx" ON "chat_messages" ("household_id","conversation_id");--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages" ("household_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fk" FOREIGN KEY ("household_id","conversation_id") REFERENCES "chat_conversations"("household_id","id") ON DELETE CASCADE;