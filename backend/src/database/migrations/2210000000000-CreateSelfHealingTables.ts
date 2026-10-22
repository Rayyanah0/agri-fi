import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the tables used by the self-healing infrastructure engine (#1194):
 *
 *  - self_healing_issues    detected issues with their diagnosis
 *  - remediation_actions    audit trail of every remediation attempt
 *  - remediation_policies   declarative safety policies
 *  - remediation_scripts    registry of the custom remediation scripts
 */
export class CreateSelfHealingTables2210000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "self_healing_issues" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fingerprint" varchar(255) NOT NULL,
        "issue_type" varchar(64) NOT NULL,
        "severity" varchar(16) NOT NULL DEFAULT 'warning',
        "status" varchar(32) NOT NULL DEFAULT 'detected',
        "component" varchar(64) NOT NULL,
        "target" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "root_cause" varchar(512),
        "root_cause_confidence" float,
        "root_cause_evidence_json" jsonb,
        "metrics_snapshot_json" jsonb,
        "labels_json" jsonb,
        "occurrences" int NOT NULL DEFAULT 1,
        "detected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_self_healing_issues_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_self_healing_issues_fingerprint" ON "self_healing_issues" ("fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_self_healing_issues_fingerprint_status" ON "self_healing_issues" ("fingerprint", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_self_healing_issues_issue_type_detected_at" ON "self_healing_issues" ("issue_type", "detected_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "remediation_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "issue_id" uuid,
        "action_type" varchar(64) NOT NULL,
        "target" varchar(255) NOT NULL,
        "component" varchar(64),
        "parameters_json" jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "safety_decision" varchar(32),
        "safety_reasons_json" jsonb,
        "policy_name" varchar(128),
        "executed_by" varchar(128) NOT NULL,
        "trigger_source" varchar(32) NOT NULL DEFAULT 'scheduler',
        "environment" varchar(32) NOT NULL,
        "output" text,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "duration_ms" int,
        "time_saved_ms" int,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_remediation_actions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_remediation_actions_issue_id" FOREIGN KEY ("issue_id")
          REFERENCES "self_healing_issues"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_remediation_actions_issue_id" ON "remediation_actions" ("issue_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_remediation_actions_action_type_created_at" ON "remediation_actions" ("action_type", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_remediation_actions_status_created_at" ON "remediation_actions" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_remediation_actions_target_created_at" ON "remediation_actions" ("target", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "remediation_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "issue_type" varchar(64),
        "action_type" varchar(64) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "requires_approval" boolean NOT NULL DEFAULT false,
        "destructive" boolean NOT NULL DEFAULT false,
        "max_executions_per_hour" int NOT NULL DEFAULT 5,
        "cooldown_minutes" int NOT NULL DEFAULT 15,
        "allowed_environments_json" jsonb NOT NULL DEFAULT '["staging"]'::jsonb,
        "staging_validated" boolean NOT NULL DEFAULT false,
        "min_replicas" int,
        "max_replicas" int,
        "description" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_remediation_policies_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_remediation_policies_name" UNIQUE ("name")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_remediation_policies_action_type_issue_type" ON "remediation_policies" ("action_type", "issue_type")`,
    );

    await queryRunner.query(`
      CREATE TABLE "remediation_scripts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "issue_type" varchar(64) NOT NULL,
        "description" text,
        "script_path" varchar(255) NOT NULL,
        "interpreter" varchar(32) NOT NULL DEFAULT 'bash',
        "timeout_seconds" int NOT NULL DEFAULT 300,
        "default_args_json" jsonb,
        "enabled" boolean NOT NULL DEFAULT true,
        "requires_approval" boolean NOT NULL DEFAULT false,
        "destructive" boolean NOT NULL DEFAULT false,
        "allowed_environments_json" jsonb NOT NULL DEFAULT '["staging"]'::jsonb,
        "version" int NOT NULL DEFAULT 1,
        "last_run_at" TIMESTAMP WITH TIME ZONE,
        "last_result" varchar(32),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_remediation_scripts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_remediation_scripts_name" UNIQUE ("name")
      );
    `);

    await this.seedPolicies(queryRunner);
    await this.seedScripts(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "remediation_scripts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "remediation_policies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "remediation_actions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "self_healing_issues"`);
  }

  /**
   * Insert the default safety policies.
   *
   * Every policy starts with `staging_validated = false`, which blocks the
   * action in production until it succeeded once in staging.
   */
  private async seedPolicies(queryRunner: QueryRunner): Promise<void> {
    const policies = [
      {
        name: 'restart-pod-default',
        actionType: 'restart_pod',
        requiresApproval: false,
        destructive: false,
        maxPerHour: 10,
        cooldown: 5,
        description:
          'Restart an unhealthy pod so that the deployment can reschedule it.',
      },
      {
        name: 'restart-service-default',
        actionType: 'restart_service',
        requiresApproval: true,
        destructive: false,
        maxPerHour: 3,
        cooldown: 30,
        description:
          'Roll out a restart of every replica of a deployment. Requires an approval.',
      },
      {
        name: 'scale-up-default',
        actionType: 'scale_up',
        requiresApproval: false,
        destructive: false,
        maxPerHour: 5,
        cooldown: 15,
        minReplicas: 2,
        maxReplicas: 10,
        description:
          'Add one replica to a deployment when its queue backlog grows.',
      },
      {
        name: 'scale-down-default',
        actionType: 'scale_down',
        requiresApproval: true,
        destructive: true,
        maxPerHour: 2,
        cooldown: 30,
        minReplicas: 2,
        maxReplicas: 10,
        description:
          'Remove a replica from a deployment. Destructive, so it requires an approval.',
      },
      {
        name: 'cleanup-disk-default',
        actionType: 'cleanup_disk',
        requiresApproval: true,
        destructive: true,
        maxPerHour: 2,
        cooldown: 60,
        description:
          'Free disk space on a host. Destructive, so it requires an approval.',
      },
      {
        name: 'custom-script-default',
        actionType: 'custom_script',
        requiresApproval: true,
        destructive: true,
        maxPerHour: 3,
        cooldown: 30,
        description:
          'Run a registered custom remediation script. Requires an approval.',
      },
    ];

    for (const policy of policies) {
      await queryRunner.query(
        `INSERT INTO "remediation_policies" (
            "name", "action_type", "enabled", "requires_approval", "destructive",
            "max_executions_per_hour", "cooldown_minutes", "allowed_environments_json",
            "staging_validated", "min_replicas", "max_replicas", "description"
          ) VALUES ($1, $2, true, $3, $4, $5, $6, '["staging","production"]'::jsonb, false, $7, $8, $9)
          ON CONFLICT ("name") DO NOTHING`,
        [
          policy.name,
          policy.actionType,
          policy.requiresApproval,
          policy.destructive,
          policy.maxPerHour,
          policy.cooldown,
          policy.minReplicas ?? null,
          policy.maxReplicas ?? null,
          policy.description,
        ],
      );
    }
  }

  /**
   * Register the built-in remediation scripts.
   */
  private async seedScripts(queryRunner: QueryRunner): Promise<void> {
    const scripts = [
      {
        name: 'cleanup-disk',
        issueType: 'disk_full',
        scriptPath: 'cleanup-disk.sh',
        description:
          'Remove rotated logs and temporary files to free disk space.',
        timeoutSeconds: 300,
      },
    ];

    for (const script of scripts) {
      await queryRunner.query(
        `INSERT INTO "remediation_scripts" (
            "name", "issue_type", "description", "script_path", "interpreter",
            "timeout_seconds", "default_args_json", "enabled", "requires_approval",
            "destructive", "allowed_environments_json", "version"
          ) VALUES ($1, $2, $3, $4, 'bash', $5, '[]'::jsonb, true, true, true, '["staging","production"]'::jsonb, 1)
          ON CONFLICT ("name") DO NOTHING`,
        [
          script.name,
          script.issueType,
          script.description,
          script.scriptPath,
          script.timeoutSeconds,
        ],
      );
    }
  }
}
