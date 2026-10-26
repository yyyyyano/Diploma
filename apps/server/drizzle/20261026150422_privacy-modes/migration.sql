CREATE TABLE "privacy_modes" (
	"user_id" uuid PRIMARY KEY,
	"cloud" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
