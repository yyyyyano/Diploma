CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"preview" text NOT NULL,
	"title" text NOT NULL,
	"paragraphs" jsonb NOT NULL,
	"action" jsonb,
	"note" jsonb,
	"sent_at" timestamp with time zone NOT NULL
);
