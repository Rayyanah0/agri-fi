import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatParticipant } from './chat-participant.entity';
import { ChatMessage } from './chat-message.entity';

export type ChatConversationKind = 'direct' | 'group';

@Entity('chat_conversations')
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', default: 'group' })
  kind: ChatConversationKind;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({
    name: 'direct_key',
    type: 'varchar',
    length: 73,
    nullable: true,
    unique: true,
  })
  directKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => ChatParticipant, (participant) => participant.conversation)
  participants: ChatParticipant[];

  @OneToMany(() => ChatMessage, (message) => message.conversation)
  messages: ChatMessage[];
}
