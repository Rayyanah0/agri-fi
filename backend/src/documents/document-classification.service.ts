import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentType } from '../trade-deals/entities/document.entity';

const DOCUMENT_TYPES: DocumentType[] = [
  'purchase_agreement',
  'bill_of_lading',
  'export_certificate',
  'warehouse_receipt',
  'harvest_completion',
];
const LOW_CONFIDENCE_THRESHOLD = 0.75;

export interface ClassificationResult {
  documentId: string;
  predictedType: DocumentType | null;
  confidence: number;
  needsReview: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
}

@Injectable()
export class DocumentClassificationService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly config: ConfigService,
  ) {}

  async classify(document: Document, file: Buffer, filename: string): Promise<ClassificationResult> {
    const searchableText = `${filename} ${file.toString('latin1', 0, Math.min(file.length, 2_000_000))}`;
    let prediction = this.classifyLocally(searchableText, document.docType);
    const providerUrl = this.config.get<string>('DOCUMENT_CLASSIFICATION_URL');
    const providerToken = this.config.get<string>('DOCUMENT_CLASSIFICATION_TOKEN');

    if (providerUrl) {
      try {
        const response = await fetch(providerUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(providerToken ? { authorization: `Bearer ${providerToken}` } : {}),
          },
          body: JSON.stringify({ filename, declaredType: document.docType, text: searchableText.slice(0, 100_000) }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const result = await response.json() as { type?: string; confidence?: number; tags?: string[] };
          if (DOCUMENT_TYPES.includes(result.type as DocumentType) && Number.isFinite(result.confidence)) {
            prediction = {
              type: result.type as DocumentType,
              confidence: Math.max(0, Math.min(1, Number(result.confidence))),
              tags: Array.isArray(result.tags) ? result.tags.filter((tag) => typeof tag === 'string').slice(0, 20) : [],
            };
          }
        }
      } catch {
        // Keep the local prediction and expose its confidence for review.
      }
    }

    const extracted = this.extractMetadata(searchableText);
    const metadata = {
      ...(document.metadata ?? {}),
      classification: {
        type: prediction.type,
        confidence: prediction.confidence,
        needsReview: prediction.confidence < LOW_CONFIDENCE_THRESHOLD,
        classifiedAt: new Date().toISOString(),
      },
      extracted,
      tags: [...new Set([...(document.metadata?.tags as string[] ?? []), ...prediction.tags])],
      retention: { archived: false, reviewAfter: this.retentionReviewDate(prediction.type) },
    };
    await this.documentRepository.update(
      { id: document.id },
      {
        metadata,
        ...(prediction.type && prediction.confidence >= LOW_CONFIDENCE_THRESHOLD
          ? { docType: prediction.type }
          : {}),
      },
    );
    return {
      documentId: document.id,
      predictedType: prediction.type,
      confidence: prediction.confidence,
      needsReview: prediction.confidence < LOW_CONFIDENCE_THRESHOLD,
      tags: metadata.tags as string[],
      metadata,
    };
  }

  private classifyLocally(text: string, declaredType: DocumentType): { type: DocumentType | null; confidence: number; tags: string[] } {
    const normalized = text.toLowerCase().replace(/[_-]+/g, ' ');
    const cues: Record<DocumentType, string[]> = {
      purchase_agreement: ['purchase agreement', 'sales contract', 'buyer', 'seller'],
      bill_of_lading: ['bill of lading', 'shipment', 'consignee', 'vessel'],
      export_certificate: ['export certificate', 'phytosanitary', 'certificate of origin'],
      warehouse_receipt: ['warehouse receipt', 'storage receipt', 'warehouse'],
      harvest_completion: ['harvest completion', 'harvest report', 'yield', 'crop harvest'],
    };
    const ranked = DOCUMENT_TYPES.map((type) => ({ type, score: cues[type].filter((cue) => normalized.includes(cue)).length }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score === 0) return { type: null, confidence: 0.25, tags: [declaredType.replace(/_/g, '-')] };
    const confidence = Math.min(0.95, 0.55 + best.score * 0.12 + (best.type === declaredType ? 0.12 : 0));
    return { type: best.type, confidence, tags: [best.type.replace(/_/g, '-')] };
  }

  private extractMetadata(text: string): Record<string, unknown> {
    const dates = [...text.matchAll(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/g)]
      .map((match) => match[0]).slice(0, 20);
    const amounts = [...text.matchAll(/(?:USD|\$|EUR|KES)\s?\d[\d,]*(?:\.\d{1,2})?/gi)]
      .map((match) => match[0]).slice(0, 20);
    return { dates, amounts, parties: [], locations: [], extractionSource: 'embedded-text-and-filename' };
  }

  private retentionReviewDate(type: DocumentType | null): string | null {
    if (!type) return null;
    const reviewAfterDays = type === 'purchase_agreement' || type === 'export_certificate' ? 3650 : 1825;
    return new Date(Date.now() + reviewAfterDays * 24 * 60 * 60 * 1000).toISOString();
  }

  async provideFeedback(documentId: string, userId: string, correctedType: DocumentType, tags: string[] = []): Promise<ClassificationResult> {
    if (!DOCUMENT_TYPES.includes(correctedType)) throw new BadRequestException('Unsupported document type');
    const document = await this.documentRepository.findOne({ where: { id: documentId, uploaderId: userId } });
    if (!document) throw new NotFoundException('Document not found');
    const feedbackHistory = Array.isArray(document.metadata?.classificationFeedback)
      ? document.metadata.classificationFeedback as Array<Record<string, unknown>>
      : [];
    const metadata = {
      ...(document.metadata ?? {}),
      classification: { type: correctedType, confidence: 1, needsReview: false, feedbackBy: userId, feedbackAt: new Date().toISOString() },
      tags: [...new Set([...(document.metadata?.tags as string[] ?? []), ...tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 20)])],
      classificationFeedback: [
        ...feedbackHistory,
        { predictedType: document.metadata?.classification?.type ?? null, correctedType, userId, createdAt: new Date().toISOString() },
      ].slice(-100),
    };
    await this.documentRepository.update({ id: documentId, uploaderId: userId }, { docType: correctedType, metadata });
    return { documentId, predictedType: correctedType, confidence: 1, needsReview: false, tags: metadata.tags as string[], metadata };
  }

  async getSimilar(documentId: string, userId: string, limit = 10): Promise<Document[]> {
    const document = await this.documentRepository.findOne({ where: { id: documentId, uploaderId: userId } });
    if (!document) throw new NotFoundException('Document not found');
    return this.documentRepository.createQueryBuilder('document')
      .where('document.uploaderId = :userId', { userId })
      .andWhere('document.id <> :documentId', { documentId })
      .andWhere('(document.docType = :docType OR document.tradeDealId = :tradeDealId)', { docType: document.docType, tradeDealId: document.tradeDealId })
      .orderBy('CASE WHEN document.tradeDealId = :tradeDealId THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('document.createdAt', 'DESC')
      .take(Math.min(Math.max(limit, 1), 50))
      .getMany();
  }

  async getAnalytics(userId: string) {
    const documents = await this.documentRepository.find({ where: { uploaderId: userId } });
    const byType = documents.reduce<Record<string, number>>((result, document) => {
      result[document.docType] = (result[document.docType] ?? 0) + 1;
      return result;
    }, {});
    const reviewed = documents.filter((document) => document.metadata?.classification);
    const averageConfidence = reviewed.length
      ? reviewed.reduce((sum, document) => sum + Number(document.metadata.classification.confidence ?? 0), 0) / reviewed.length
      : null;
    return { total: documents.length, byType, classified: reviewed.length, needsReview: reviewed.filter((document) => document.metadata.classification.needsReview).length, averageConfidence };
  }

  async getClusters(userId: string) {
    const documents = await this.documentRepository.find({
      where: { uploaderId: userId },
      order: { createdAt: 'DESC' },
    });
    const groups = new Map<string, Document[]>();
    for (const document of documents) {
      const classifiedType = document.metadata?.classification?.type;
      const type = typeof classifiedType === 'string' ? classifiedType : document.docType;
      const key = `${document.tradeDealId}:${type}`;
      const group = groups.get(key) ?? [];
      group.push(document);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, items]) => ({
      clusterId: key,
      tradeDealId: items[0].tradeDealId,
      documentType: items[0].metadata?.classification?.type ?? items[0].docType,
      documentCount: items.length,
      documents: items,
    }));
  }
}