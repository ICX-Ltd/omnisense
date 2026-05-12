import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { PromptTemplate } from '../../db/entities/prompt-template.entity';
import { PromptTemplateHistory } from '../../db/entities/prompt-template-history.entity';
import {
  CreatePromptTemplateDto,
  UpdatePromptTemplateDto,
} from './dto/upsert-prompt.dto';
import { SEED_FRAGMENTS } from './seed-fragments';

export type PromptPlaceholders = Record<string, string>;

const RAC_CAMPAIGN_REGEX = /rac/i;

function substitute(template: string, values: PromptPlaceholders): string {
  // Substitute {{name}} placeholders. Unknown placeholders are left in place
  // so the user spots them while editing.
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name)
      ? values[name]
      : match;
  });
}

@Injectable()
export class PromptsService implements OnModuleInit {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectRepository(PromptTemplate)
    private readonly repo: Repository<PromptTemplate>,
    @InjectRepository(PromptTemplateHistory)
    private readonly historyRepo: Repository<PromptTemplateHistory>,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedIfMissing();
    } catch (err) {
      this.logger.warn(
        `Prompt fragment seed skipped — run sql/create-prompt-templates.sql. Reason: ${
          (err as Error).message
        }`,
      );
    }
  }

  // ─── role gate ────────────────────────────────────────────────────────────

  private verifyToken(authHeader?: string): {
    userId: string;
    roleId: string | null;
  } {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const payload: any = this.jwt.verify(token);
      return {
        userId: payload.sub as string,
        roleId: (payload.roleId as string | null) ?? null,
      };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  requireRole(authHeader: string | undefined, allowed: string[]): string {
    const { userId, roleId } = this.verifyToken(authHeader);
    const normalized = String(roleId ?? '').trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new ForbiddenException('Insufficient role');
    }
    return userId;
  }

  // ─── seed ─────────────────────────────────────────────────────────────────

  private async seedIfMissing() {
    for (const fragment of SEED_FRAGMENTS) {
      const existing = await this.repo.findOne({
        where: { key: fragment.key },
      });
      if (existing) continue;

      const entity = this.repo.create({
        key: fragment.key,
        interactionType: fragment.interactionType,
        kind: fragment.kind,
        campaign: fragment.campaign,
        label: fragment.label,
        notes: fragment.notes,
        body: fragment.body,
        version: 1,
        isActive: true,
      });

      try {
        await this.repo.save(entity);
        this.logger.log(`Seeded prompt fragment "${fragment.key}"`);
      } catch (err) {
        // Another worker may have inserted concurrently — ignore dup key errors.
        this.logger.warn(
          `Could not seed prompt fragment "${fragment.key}": ${
            (err as Error).message
          }`,
        );
      }
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(filters: {
    interactionType?: string;
    campaign?: string;
    kind?: string;
  }) {
    const qb = this.repo
      .createQueryBuilder('p')
      .orderBy('p.interactionType', 'ASC')
      .addOrderBy('p.kind', 'ASC')
      .addOrderBy('p.key', 'ASC');

    if (filters.interactionType) {
      qb.andWhere('p.interactionType = :it', {
        it: filters.interactionType,
      });
    }
    if (filters.campaign) {
      qb.andWhere('p.campaign = :c', { c: filters.campaign });
    }
    if (filters.kind) {
      qb.andWhere('p.kind = :k', { k: filters.kind });
    }

    return qb.getMany();
  }

  async findOne(id: string) {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Prompt template not found');
    return found;
  }

  async create(dto: CreatePromptTemplateDto, updatedById: string | null) {
    const clash = await this.repo.findOne({ where: { key: dto.key } });
    if (clash) {
      throw new ConflictException(
        `A prompt template with key "${dto.key}" already exists`,
      );
    }
    const entity = this.repo.create({
      key: dto.key,
      interactionType: dto.interactionType,
      kind: dto.kind,
      campaign: dto.campaign ?? null,
      label: dto.label,
      notes: dto.notes ?? null,
      body: dto.body,
      version: 1,
      isActive: dto.isActive ?? true,
      updatedById,
    });
    return this.repo.save(entity);
  }

  async update(
    id: string,
    dto: UpdatePromptTemplateDto,
    updatedById: string | null,
  ) {
    const existing = await this.findOne(id);

    const bodyChanged =
      typeof dto.body === 'string' && dto.body !== existing.body;

    if (bodyChanged) {
      await this.historyRepo.save(
        this.historyRepo.create({
          promptTemplateId: existing.id,
          key: existing.key,
          version: existing.version,
          body: existing.body,
          label: existing.label,
          notes: existing.notes,
          updatedById: existing.updatedById,
        }),
      );
    }

    if (dto.interactionType !== undefined) {
      existing.interactionType = dto.interactionType;
    }
    if (dto.kind !== undefined) existing.kind = dto.kind;
    if (dto.campaign !== undefined) existing.campaign = dto.campaign ?? null;
    if (dto.label !== undefined) existing.label = dto.label;
    if (dto.notes !== undefined) existing.notes = dto.notes ?? null;
    if (dto.body !== undefined) existing.body = dto.body;
    if (dto.isActive !== undefined) existing.isActive = dto.isActive;

    if (bodyChanged) existing.version = existing.version + 1;
    existing.updatedById = updatedById;

    return this.repo.save(existing);
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    await this.repo.remove(existing);
    return { ok: true };
  }

  async history(id: string) {
    await this.findOne(id);
    return this.historyRepo.find({
      where: { promptTemplateId: id },
      order: { version: 'DESC' },
    });
  }

  // ─── composer ─────────────────────────────────────────────────────────────

  private async getActiveByKey(key: string): Promise<PromptTemplate | null> {
    return this.repo.findOne({ where: { key, isActive: true } });
  }

  async composeCallPrompt(transcript: string, campaign?: string | null) {
    const base = await this.getActiveByKey('call.base');
    if (!base) {
      throw new Error(
        'Missing active "call.base" prompt template — cannot compose call prompt',
      );
    }

    const campaignSection = await this.resolveCallCampaignSection(campaign);

    const withSections = substitute(base.body, {
      campaign_section: campaignSection,
    });

    return substitute(withSections, {
      transcript,
      campaign: campaign ?? '',
    });
  }

  private async resolveCallCampaignSection(
    campaign?: string | null,
  ): Promise<string> {
    if (!campaign || campaign === 'unknown') {
      const unknown = await this.getActiveByKey('call.campaign.unknown');
      return unknown?.body ?? '';
    }

    const specific = await this.getActiveByKey(`call.campaign.${campaign}`);
    if (specific) {
      return substitute(specific.body, { campaign });
    }

    const fallback = await this.getActiveByKey('call.campaign.default');
    if (fallback) {
      return substitute(fallback.body, { campaign });
    }

    return '';
  }

  async composeChatPrompt(transcript: string, campaign?: string | null) {
    const base = await this.getActiveByKey('chat.base');
    if (!base) {
      throw new Error(
        'Missing active "chat.base" prompt template — cannot compose chat prompt',
      );
    }

    const campaignLine =
      campaign && campaign !== 'unknown' ? `Campaign context: ${campaign}\n` : '';

    const isRac = !!campaign && RAC_CAMPAIGN_REGEX.test(campaign);

    const opsSection = await this.getActiveByKey('chat.operations.default');
    const opsSchema = await this.getActiveByKey(
      'chat.operations_schema.default',
    );

    // Chat response-time metrics are computed in code from the transcript
    // (backend/src/insights/chat-response-time.ts) — no LLM prompt section.

    const racIdleRule = isRac
      ? await this.getActiveByKey('chat.rac.idle_rule')
      : null;
    const racOpportunity = isRac
      ? await this.getActiveByKey('chat.rac.opportunity')
      : null;
    const racQa = isRac ? await this.getActiveByKey('chat.rac.qa') : null;
    const racQaSchema = isRac
      ? await this.getActiveByKey('chat.rac.qa_schema')
      : null;
    const racObjection = isRac
      ? await this.getActiveByKey('chat.rac.objection')
      : null;
    const racObjectionSchema = isRac
      ? await this.getActiveByKey('chat.rac.objection_schema')
      : null;

    const withSections = substitute(base.body, {
      campaign_line: campaignLine,
      idle_rule_section: racIdleRule?.body ?? '',
      opportunity_section: racOpportunity?.body ?? '',
      operations_section: opsSection?.body ?? '',
      qa_section: racQa?.body ?? '',
      objection_section: racObjection?.body ?? '',
      operations_schema: opsSchema?.body ?? '',
      qa_schema: racQaSchema ? `,\n\n  ${racQaSchema.body}` : '',
      objection_schema: racObjectionSchema
        ? `,\n\n  ${racObjectionSchema.body}`
        : '',
    });

    return substitute(withSections, {
      transcript,
      campaign: campaign ?? '',
    });
  }

  async preview(
    interactionType: 'call' | 'chat',
    campaign?: string | null,
    transcript?: string,
  ) {
    const sampleTranscript =
      transcript ?? '[transcript preview — actual transcript inserted at runtime]';
    return interactionType === 'chat'
      ? this.composeChatPrompt(sampleTranscript, campaign ?? null)
      : this.composeCallPrompt(sampleTranscript, campaign ?? null);
  }
}
