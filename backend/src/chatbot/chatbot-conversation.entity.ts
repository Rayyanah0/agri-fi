import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('chatbot_conversations')
export class ChatbotConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  message: string;

  @Column()
  response: string;

  @Column({ name: 'detected_emotion', nullable: true })
  detectedEmotion: string | null;

  @Column({ type: 'float', nullable: true })
  emotionConfidence: number | null;

  @Column({ name: 'user_satisfaction', nullable: true })
  userSatisfaction: number | null; // 1-5 rating

  @Column({ name: 'escalated', default: false })
  escalated: boolean;

  @Column({ name: 'escalated_to', nullable: true })
  escalatedTo: string | null;

  @Column({ name: 'language', default: 'en' })
  language: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
