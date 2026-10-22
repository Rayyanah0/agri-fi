import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChat1900000000000 implements MigrationInterface {
  name = 'CreateChat1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(16) NOT NULL DEFAULT 'group',
        "name" varchar(120),
        "deal_id" uuid,
        "created_by" uuid NOT NULL,
        "direct_key" varchar(73),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_conversations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_conversations_deal" FOREIGN KEY ("deal_id")
          REFERENCES "trade_deals"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_chat_conversations_creator" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX "UQ_chat_conversations_direct_key"
        ON "chat_conversations" ("direct_key");

      CREATE TABLE "chat_conversation_participants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "last_read_at" TIMESTAMP WITH TIME ZONE,
        "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_conversation_participants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chat_participant_conversation_user"
          UNIQUE ("conversation_id", "user_id"),
        CONSTRAINT "FK_chat_participant_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_participant_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_chat_participant_user"
        ON "chat_conversation_participants" ("user_id");

      CREATE TABLE "chat_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "content" text NOT NULL,
        "reply_to_id" uuid,
        "reactions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_message_sender" FOREIGN KEY ("sender_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_message_reply" FOREIGN KEY ("reply_to_id")
          REFERENCES "chat_messages"("id") ON DELETE SET NULL
      );
      CREATE INDEX "IDX_chat_message_conversation_created"
        ON "chat_messages" ("conversation_id", "created_at" DESC);

      CREATE TABLE "chat_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "message_id" uuid NOT NULL,
        "storage_key" text NOT NULL,
        "file_name" text NOT NULL,
        "mime_type" varchar(120) NOT NULL,
        "size_bytes" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_attachments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_attachment_message" FOREIGN KEY ("message_id")
          REFERENCES "chat_messages"("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "chat_attachments";
      DROP TABLE "chat_messages";
      DROP TABLE "chat_conversation_participants";
      DROP TABLE "chat_conversations";
    `);
  }
}
