CREATE TABLE "identity_recovery_codes" (
	"user_id" uuid PRIMARY KEY,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_recovery_codes" ADD CONSTRAINT "identity_recovery_codes_user_id_identity_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE;