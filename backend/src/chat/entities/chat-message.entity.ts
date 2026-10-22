import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { ChatConversation } from './chat-conversation.entity';
import { ChatAttachment } from './chat-attachment.entity';
import { encryptedChatMessageTransformer } from '../chat.encryption';

@Entity('chat_messages')
@Index('IDX_chat_message_conversation_created', ['conversationId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ChatConversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ChatConversation;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({
    type: 'text',
    transformer: encryptedChatMessageTransformer,
  })
  content: string;

  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId: string | null;

  @ManyToOne(() => ChatMessage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reply_to_id' })
  replyTo: ChatMessage | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  reactions: Record<string, string[]>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => ChatAttachment, (attachment) => attachment.message)
  attachments: ChatAttachment[];
}
