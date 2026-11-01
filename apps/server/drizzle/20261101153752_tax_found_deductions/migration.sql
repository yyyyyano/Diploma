CREATE TABLE "found_deductions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"basis_key" text NOT NULL,
	"operation_id" uuid,
	"year" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reason" text,
	"amount_minor" bigint,
	"trace_id" uuid,
	"basis_on" date,
	"basis_minor" bigint,
	"payee" text,
	"found_on" date NOT NULL,
	CONSTRAINT "found_deductions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "found_deductions_kind_check" CHECK ("kind" in ('education', 'housing', 'children')),
	CONSTRAINT "found_deductions_status_check" CHECK ("status" in ('new', 'shown', 'dismissed', 'filed')),
	CONSTRAINT "found_deductions_reason_check" CHECK ("reason" is null or "reason" in ('ask-queue', 'check')),
	CONSTRAINT "found_deductions_amount_check" CHECK ("amount_minor" is null or "amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "found_deductions_basis_idx" ON "found_deductions" ("household_id","user_id","kind","basis_key");