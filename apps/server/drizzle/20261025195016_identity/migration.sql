CREATE TABLE "identity_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_households" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_users_role_check" CHECK ("role" in ('user', 'admin')),
	CONSTRAINT "identity_users_status_check" CHECK ("status" in ('active', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"id" integer PRIMARY KEY,
	"initialized" boolean DEFAULT false NOT NULL,
	"initialized_at" timestamp with time zone,
	CONSTRAINT "system_state_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE INDEX "identity_credentials_user_id_idx" ON "identity_credentials" ("user_id");--> statement-breakpoint
CREATE INDEX "identity_sessions_user_id_idx" ON "identity_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "identity_users_household_id_idx" ON "identity_users" ("household_id");--> statement-breakpoint
CREATE INDEX "identity_verifications_identifier_idx" ON "identity_verifications" ("identifier");--> statement-breakpoint
ALTER TABLE "identity_credentials" ADD CONSTRAINT "identity_credentials_user_id_identity_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_user_id_identity_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_household_id_identity_households_id_fkey" FOREIGN KEY ("household_id") REFERENCES "identity_households"("id");--> statement-breakpoint
-- Руками (AUTH-10): единственная строка признака первого запуска; setup переводит её в initialized = true.
INSERT INTO "system_state" ("id", "initialized") VALUES (1, false);
