import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, ILike, Repository } from 'typeorm';
import { EventEmitter } from 'events';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { DealCoFarmer } from '../trade-deals/entities/deal-co-farmer.entity';
import { DocumentsService } from '../documents/documents.service';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatParticipant } from './entities/chat-participant.entity';
import { chatFileEncryption } from './chat.encryption';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

export const CHAT_EVENT_BUS = 'CHAT_EVENT_BUS';
export const CHAT_MESSAGE_CREATED = 'chat.message.created';
export const CHAT_MESSAGE_UPDATED = 'chat.message.updated';
export const CHAT_READ_UPDATED = 'chat.read.updated';

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
]);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_SEARCH_SCAN = 10_000;

export interface CreateConversationInput {
  participantIds: string[];
  name?: string;
  dealId?: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatParticipant)
    private readonly participantRepo: Repository<ChatParticipant>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(ChatAttachment)
    private readonly attachmentRepo: Repository<ChatAttachment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(DealCoFarmer)
    private readonly coFarmerRepo: Repository<DealCoFarmer>,
    private readonly documentsService: DocumentsService,
    @Inject(CHAT_EVENT_BUS) private readonly eventBus: EventEmitter,
  ) {}

  async searchContacts(userId: string, query: string) {
    const term = query.trim();
    if (term.length < 2 || term.length > 100) {
      throw new BadRequestException(
        'Contact search must be between 2 and 100 characters',
      );
    }
    return this.userRepo
      .find({
        where: { email: ILike(`%${term}%`) },
        select: { id: true, email: true, role: true },
        take: 20,
      })
      .then((users) => users.filter((user) => user.id !== userId));
  }

  async createConversation(userId: string, input: CreateConversationInput) {
    if (!input || !Array.isArray(input.participantIds)) {
      throw new BadRequestException('participantIds must be an array');
    }
    if (input.name !== undefined && typeof input.name !== 'string') {
      throw new BadRequestException('Group name must be a string');
    }
    const participantIds = [...new Set(input.participantIds ?? [])].filter(
      (id) => id !== userId,
    );
    if (participantIds.length < 1 || participantIds.length > 19) {
      throw new BadRequestException(
        'Choose between 1 and 19 other participants',
      );
    }
    if (input.name && input.name.trim().length > 120) {
      throw new BadRequestException(
        'Group name must be 120 characters or fewer',
      );
    }
    if (
      participantIds.some((id) => typeof id !== 'string' || !this.isUuid(id)) ||
      (input.dealId !== undefined && !this.isUuid(input.dealId))
    ) {
      throw new BadRequestException(
        'Participant and deal IDs must be valid UUIDs',
      );
    }

    const users = await this.userRepo.findBy({ id: In(participantIds) });
    if (users.length !== participantIds.length) {
      throw new BadRequestException('One or more participants do not exist');
    }

    if (input.dealId) {
      await this.assertDealParticipants(userId, input.dealId, participantIds);
    }

    const kind =
      participantIds.length === 1 && !input.name && !input.dealId
        ? 'direct'
        : 'group';
    const directKey =
      kind === 'direct' ? [userId, participantIds[0]].sort().join(':') : null;

    if (directKey) {
      const existing = await this.conversationRepo.findOne({
        where: { directKey },
        relations: { participants: { user: true } },
      });
      if (existing) return this.serializeConversation(existing, userId);
    }

    const conversation = await this.conversationRepo.save(
      this.conversationRepo.create({
        kind,
        name: input.name?.trim() || null,
        dealId: input.dealId ?? null,
        createdBy: userId,
        directKey,
      }),
    );
    const members = [userId, ...participantIds];
    await this.participantRepo.save(
      members.map((memberId) =>
        this.participantRepo.create({
          conversationId: conversation.id,
          userId: memberId,
        }),
      ),
    );
    const created = await this.getConversation(conversation.id, userId);
    return this.serializeConversation(created, userId);
  }

  async listConversations(userId: string) {
    const participants = await this.participantRepo.find({
      where: { userId },
      relations: { conversation: { participants: { user: true } } },
      order: { joinedAt: 'DESC' },
      take: 100,
    });
    const ids = participants.map((participant) => participant.conversationId);
    if (!ids.length) return [];

    const latestMessages = await this.messageRepo
      .createQueryBuilder('message')
      .distinctOn(['message.conversationId'])
      .where('message.conversationId IN (:...ids)', { ids })
      .orderBy('message.conversationId', 'ASC')
      .addOrderBy('message.createdAt', 'DESC')
      .getMany();
    const latestByConversation = new Map(
      latestMessages.map((message) => [message.conversationId, message]),
    );
    const unreadRows = await this.messageRepo
      .createQueryBuilder('message')
      .innerJoin(
        ChatParticipant,
        'participant',
        'participant.conversation_id = message.conversation_id AND participant.user_id = :userId',
        { userId },
      )
      .where('message.conversation_id IN (:...ids)', { ids })
      .andWhere('message.sender_id != :userId', { userId })
      .andWhere(
        "message.created_at > COALESCE(participant.last_read_at, TIMESTAMPTZ 'epoch')",
      )
      .select('message.conversation_id', 'conversationId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('message.conversation_id')
      .getRawMany();
    const unreadByConversation = new Map(
      unreadRows.map((row) => [row.conversationId, Number(row.count)]),
    );

    return participants.map((participant) => {
      const conversation = participant.conversation;
      const latestMessage = latestByConversation.get(conversation.id) ?? null;
      const unreadCount = unreadByConversation.get(conversation.id) ?? 0;
      return {
        ...this.serializeConversation(conversation, userId),
        lastMessage: latestMessage
          ? this.serializeMessage(latestMessage, conversation.participants)
          : null,
        unreadCount,
      };
    });
  }

  async getConversation(conversationId: string, userId: string) {
    if (!this.isUuid(conversationId)) {
      throw new BadRequestException('Conversation ID must be a valid UUID');
    }
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: { participants: { user: true } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.assertMember(conversation, userId);
    return conversation;
  }

  async getMessages(conversationId: string, userId: string, limit = 50) {
    const conversation = await this.getConversation(conversationId, userId);
    const messages = await this.messageRepo.find({
      where: { conversationId },
      relations: { sender: true, replyTo: { sender: true }, attachments: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return messages
      .reverse()
      .map((message) =>
        this.serializeMessage(message, conversation.participants),
      );
  }

  async searchMessages(conversationId: string, userId: string, query: string) {
    const conversation = await this.getConversation(conversationId, userId);
    const term = query.trim();
    if (term.length < 2 || term.length > 100) {
      throw new BadRequestException(
        'Search text must be between 2 and 100 characters',
      );
    }
    const matchIds: string[] = [];
    const searchTerm = term.toLocaleLowerCase();
    const pageSize = 500;
    for (
      let offset = 0;
      offset < MAX_SEARCH_SCAN && matchIds.length < 50;
      offset += pageSize
    ) {
      const page = await this.messageRepo.find({
        where: { conversationId },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          createdAt: true,
        },
        order: { createdAt: 'DESC' },
        skip: offset,
        take: pageSize,
      });
      if (!page.length) break;
      matchIds.push(
        ...page
          .filter((message) =>
            message.content.toLocaleLowerCase().includes(searchTerm),
          )
          .map((message) => message.id)
          .slice(0, 50 - matchIds.length),
      );
      if (page.length < pageSize) break;
    }
    if (!matchIds.length) return [];
    const matches = await this.messageRepo.find({
      where: { id: In(matchIds) },
      relations: { sender: true, replyTo: { sender: true }, attachments: true },
    });
    const byId = new Map(matches.map((message) => [message.id, message]));
    return matchIds
      .map((id) => byId.get(id))
      .filter((message): message is ChatMessage => Boolean(message))
      .map((message) =>
        this.serializeMessage(message, conversation.participants),
      );
  }

  async createMessage(
    conversationId: string,
    userId: string,
    content: string,
    replyToId?: string,
  ) {
    const conversation = await this.getConversation(conversationId, userId);
    const normalized = typeof content === 'string' ? content.trim() : '';
    if (!normalized || normalized.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message must contain 1-${MAX_MESSAGE_LENGTH} characters`,
      );
    }
    if (replyToId) {
      if (!this.isUuid(replyToId)) {
        throw new BadRequestException('Reply ID must be a valid UUID');
      }
      const parent = await this.messageRepo.findOne({
        where: { id: replyToId, conversationId },
      });
      if (!parent)
        throw new BadRequestException(
          'Reply target must be in this conversation',
        );
    }
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        senderId: userId,
        content: normalized,
        replyToId: replyToId ?? null,
        reactions: {},
      }),
    );
    const saved = await this.messageRepo.findOneOrFail({
      where: { id: message.id },
      relations: { sender: true, replyTo: { sender: true }, attachments: true },
    });
    const result = this.serializeMessage(saved, conversation.participants);
    this.eventBus.emit(CHAT_MESSAGE_CREATED, {
      conversationId,
      message: result,
    });
    return result;
  }

  async addReaction(messageId: string, userId: string, emoji: string) {
    if (!this.isUuid(messageId)) {
      throw new BadRequestException('Message ID must be a valid UUID');
    }
    if (!['👍', '❤️', '😂', '🎉', '🙏', '👀'].includes(emoji)) {
      throw new BadRequestException('Unsupported reaction');
    }
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: {
        conversation: { participants: { user: true } },
        sender: true,
        attachments: true,
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    this.assertMember(message.conversation, userId);
    const reactions = { ...message.reactions };
    const users = new Set(reactions[emoji] ?? []);
    if (users.has(userId)) users.delete(userId);
    else users.add(userId);
    if (users.size) reactions[emoji] = [...users];
    else delete reactions[emoji];
    message.reactions = reactions;
    const updated = await this.messageRepo.save(message);
    const result = this.serializeMessage(
      updated,
      message.conversation.participants,
    );
    this.eventBus.emit(CHAT_MESSAGE_UPDATED, {
      conversationId: message.conversationId,
      message: result,
    });
    return result;
  }

  async markRead(conversationId: string, userId: string) {
    const conversation = await this.getConversation(conversationId, userId);
    const lastReadAt = new Date();
    await this.participantRepo.update(
      { conversationId, userId },
      { lastReadAt },
    );
    this.eventBus.emit(CHAT_READ_UPDATED, {
      conversationId,
      userId,
      lastReadAt,
    });
    return {
      conversationId,
      lastReadAt,
      participantCount: conversation.participants.length,
    };
  }

  async uploadAttachment(
    conversationId: string,
    userId: string,
    file?: Express.Multer.File,
  ) {
    const conversation = await this.getConversation(conversationId, userId);
    if (!file?.buffer?.length)
      throw new BadRequestException('File is required');
    if (file.size > MAX_ATTACHMENT_SIZE) {
      throw new BadRequestException('File exceeds 10 MB limit');
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only PDF, PNG, JPEG, and plain text files are allowed',
      );
    }
    await this.documentsService.scanBeforeUpload(file, userId);
    const detectedType = await fileTypeFromBuffer(file.buffer);
    if (
      (file.mimetype === 'application/pdf' &&
        detectedType?.mime !== 'application/pdf') ||
      (file.mimetype === 'image/png' && detectedType?.mime !== 'image/png') ||
      (file.mimetype === 'image/jpeg' && detectedType?.mime !== 'image/jpeg') ||
      (file.mimetype === 'text/plain' &&
        (detectedType ||
          file.buffer.includes(0) ||
          file.buffer.toString('utf8').includes('\uFFFD')))
    ) {
      throw new BadRequestException(
        'File content does not match its declared type',
      );
    }
    const storage = await this.documentsService.getStorageServicePublic();
    const encryptedFile = chatFileEncryption.encrypt(file.buffer);
    const stored = await storage.upload(
      encryptedFile,
      'application/octet-stream',
    );
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        senderId: userId,
        content: `Shared a file: ${file.originalname.slice(0, 200)}`,
        reactions: {},
      }),
    );
    const attachment = await this.attachmentRepo.save(
      this.attachmentRepo.create({
        messageId: message.id,
        storageKey: stored.hash,
        fileName: file.originalname.replace(/[\\/\r\n"\0]/g, '_').slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: file.size,
      }),
    );
    const saved = await this.messageRepo.findOneOrFail({
      where: { id: message.id },
      relations: { sender: true, attachments: true },
    });
    const result = this.serializeMessage(saved, conversation.participants);
    result.attachments = result.attachments.map((item) => ({
      ...item,
      downloadUrl: `/v1/chat/attachments/${attachment.id}`,
    }));
    this.eventBus.emit(CHAT_MESSAGE_CREATED, {
      conversationId,
      message: result,
    });
    return result;
  }

  async getAttachment(attachmentId: string, userId: string) {
    if (!this.isUuid(attachmentId)) {
      throw new BadRequestException('Attachment ID must be a valid UUID');
    }
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId },
      relations: { message: { conversation: { participants: true } } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    this.assertMember(attachment.message.conversation, userId);
    const storage = await this.documentsService.getStorageServicePublic();
    let encrypted: Buffer;
    if (
      attachment.storageKey.startsWith('Qm') ||
      attachment.storageKey.startsWith('bafy')
    ) {
      encrypted = await storage.fetchAndVerifyIpfsDocument(
        attachment.storageKey,
      );
    } else {
      const result = await storage.getDocument(attachment.storageKey);
      if (!result.data) {
        throw new ServiceUnavailableException(
          'Chat attachment is not available yet',
        );
      }
      encrypted = result.data;
    }
    try {
      return {
        data: chatFileEncryption.decrypt(encrypted),
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      };
    } catch (error) {
      this.logger.error(
        `Unable to decrypt chat attachment ${attachment.id}`,
        error,
      );
      throw new UnprocessableEntityException(
        'Chat attachment could not be decrypted',
      );
    }
  }

  async getAnalytics(userId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const rows = await this.messageRepo
      .createQueryBuilder('message')
      .innerJoin(
        ChatParticipant,
        'participant',
        'participant.conversation_id = message.conversation_id AND participant.user_id = :userId',
        { userId },
      )
      .where('message.created_at >= :since', { since })
      .select("date_trunc('day', message.created_at)", 'day')
      .addSelect('COUNT(*) FILTER (WHERE message.sender_id = :userId)', 'sent')
      .addSelect(
        'COUNT(*) FILTER (WHERE message.sender_id <> :userId)',
        'received',
      )
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany();
    const conversationCount = await this.participantRepo.count({
      where: { userId },
    });
    return {
      periodDays: 30,
      conversationCount,
      sent: rows.reduce((sum, row) => sum + Number(row.sent), 0),
      received: rows.reduce((sum, row) => sum + Number(row.received), 0),
      dailyActivity: rows.map((row) => ({
        day: row.day,
        sent: Number(row.sent),
        received: Number(row.received),
      })),
    };
  }

  private async assertDealParticipants(
    userId: string,
    dealId: string,
    requestedIds: string[],
  ) {
    const deal = await this.dealRepo.findOne({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Trade deal not found');
    const [investments, coFarmers] = await Promise.all([
      this.investmentRepo.find({
        where: {
          tradeDealId: dealId,
          status: In([
            InvestmentStatus.PENDING,
            InvestmentStatus.CONFIRMED,
            InvestmentStatus.ACTIVE,
            InvestmentStatus.RELEASING,
            InvestmentStatus.COMPLETED,
          ]),
        },
      }),
      this.coFarmerRepo.find({
        where: { tradeDealId: dealId, status: 'accepted' },
      }),
    ]);
    const allowed = new Set([
      deal.farmerId,
      deal.traderId,
      ...investments.map((investment) => investment.investorId),
      ...coFarmers.map((coFarmer) => coFarmer.farmerId),
    ]);
    if (!allowed.has(userId) || requestedIds.some((id) => !allowed.has(id))) {
      throw new ForbiddenException(
        'Deal conversations are limited to deal participants',
      );
    }
  }

  private assertMember(
    conversation: Pick<ChatConversation, 'participants'>,
    userId: string,
  ) {
    if (
      !conversation.participants?.some(
        (participant) => participant.userId === userId,
      )
    ) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private serializeConversation(
    conversation: ChatConversation,
    userId: string,
  ) {
    return {
      id: conversation.id,
      kind: conversation.kind,
      name: conversation.name,
      dealId: conversation.dealId,
      createdAt: conversation.createdAt,
      participants: (conversation.participants ?? []).map((participant) => ({
        userId: participant.userId,
        email: participant.user?.email,
        role: participant.user?.role,
        lastReadAt: participant.lastReadAt,
        self: participant.userId === userId,
      })),
    };
  }

  private serializeMessage(
    message: ChatMessage,
    participants: ChatParticipant[] = [],
  ) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderEmail: message.sender?.email,
      content: message.content,
      replyToId: message.replyToId,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            content: message.replyTo.content,
            senderEmail: message.replyTo.sender?.email,
          }
        : null,
      reactions: message.reactions ?? {},
      createdAt: message.createdAt,
      readBy: participants
        .filter(
          (participant) =>
            participant.userId !== message.senderId &&
            participant.lastReadAt &&
            participant.lastReadAt >= message.createdAt,
        )
        .map((participant) => participant.userId),
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        downloadUrl: `/v1/chat/attachments/${attachment.id}`,
      })),
    };
  }
}
