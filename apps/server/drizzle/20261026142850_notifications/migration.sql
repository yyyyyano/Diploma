CREATE TABLE "admin_notification_reads" (
	"notification_id" uuid,
	"user_id" uuid,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_notification_reads_pkey" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"params" jsonb NOT NULL,
	"object_ref" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"params" jsonb NOT NULL,
	"object_ref" jsonb,
	"decision_id" uuid,
	"undo_token" uuid,
	"shown_on_web" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_notifications_key_idx" ON "admin_notifications" ("kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_idx" ON "notification_preferences" ("household_id","user_id","kind","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_key_idx" ON "notifications" ("household_id","user_id","kind","key");--> statement-breakpoint
ALTER TABLE "admin_notification_reads" ADD CONSTRAINT "admin_notification_reads_SZj7ZmLYffam_fkey" FOREIGN KEY ("notification_id") REFERENCES "admin_notifications"("id") ON DELETE CASCADE;