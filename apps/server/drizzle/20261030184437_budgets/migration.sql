CREATE TABLE "budget_alerts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject_id" uuid NOT NULL,
	"alert_key" text NOT NULL,
	CONSTRAINT "budget_alerts_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "budget_contributions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"goal_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"made_on" date NOT NULL,
	CONSTRAINT "budget_contributions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "budget_contributions_amount_check" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_goals" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"deadline" date NOT NULL,
	"account_id" uuid,
	"created_on" date NOT NULL,
	CONSTRAINT "budget_goals_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "budget_goals_kind_check" CHECK ("kind" in ('piggy', 'account')),
	CONSTRAINT "budget_goals_target_check" CHECK ("target_minor" > 0),
	CONSTRAINT "budget_goals_account_check" CHECK (("kind" = 'account') = ("account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "budget_limits" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category_key" text NOT NULL,
	"limit_minor" bigint NOT NULL,
	"notify_at80" boolean DEFAULT true NOT NULL,
	"notify_at100" boolean DEFAULT true NOT NULL,
	CONSTRAINT "budget_limits_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "budget_limits_limit_check" CHECK ("limit_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_revisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"existed" boolean NOT NULL,
	"before" jsonb NOT NULL,
	CONSTRAINT "budget_revisions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "budget_revisions_kind_check" CHECK ("kind" in ('limit', 'goal'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_key_idx" ON "budget_alerts" ("household_id","user_id","subject_id","alert_key");--> statement-breakpoint
CREATE INDEX "budget_contributions_goal_id_fk_idx" ON "budget_contributions" ("household_id","goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_limits_category_idx" ON "budget_limits" ("household_id","user_id","category_key");--> statement-breakpoint
ALTER TABLE "budget_contributions" ADD CONSTRAINT "budget_contributions_goal_id_fk" FOREIGN KEY ("household_id","goal_id") REFERENCES "budget_goals"("household_id","id") ON DELETE CASCADE;