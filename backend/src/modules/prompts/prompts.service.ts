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

// Map of fragment key → version, capturing exactly which prompt fragments (and
// which version of each) produced a given prompt. Stamped onto the insight.
export type PromptVersions = Record<string, number>;

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

  /**
   * Public lookup for the active body of a single fragment by key. Returns null
   * if no active row exists. Used by standalone prompts (e.g. the narrative
   * builders) that load an editable template and fall back to a hardcoded
   * default when the fragment is missing.
   */
  async getActiveFragmentBody(key: string): Promise<string | null> {
    const row = await this.getActiveByKey(key);
    return row?.body ?? null;
  }

  async composeCallPrompt(transcript: string, campaign?: string | null) {
    // Records every fragment that actually goes into the prompt as {key: version}
    // so the produced insight can be stamped with the exact prompt provenance.
    const versions: PromptVersions = {};
    const record = (t: PromptTemplate | null) => {
      if (t) versions[t.key] = t.version;
      return t;
    };

    const base = record(await this.getActiveByKey('call.base'));
    if (!base) {
      throw new Error(
        'Missing active "call.base" prompt template — cannot compose call prompt',
      );
    }

    const campaignSection = await this.resolveCallCampaignSection(
      campaign,
      versions,
    );

    // Optional campaign-specific Q&A pair (e.g. Parity). Both must be present
    // to inject; one without the other would produce invalid output.
    let campaignQaSection = '';
    let campaignQaSchema = '';
    // Optional campaign-specific TRANSCRIPT insight pair (e.g. NMGB Survey).
    // Independent of the Q&A pair — a campaign may ship either, both, or neither.
    // Persisted to campaign_transcript_json (separate from campaign_answers_json).
    let campaignTranscriptSection = '';
    let campaignTranscriptSchema = '';
    if (campaign && campaign !== 'unknown') {
      const qa = record(await this.getActiveByKey(`call.campaign.${campaign}.qa`));
      const qaSchema = record(
        await this.getActiveByKey(`call.campaign.${campaign}.qa_schema`),
      );
      if (qa && qaSchema) {
        campaignQaSection = substitute(qa.body, { campaign });
        campaignQaSchema = `,\n\n  ${substitute(qaSchema.body, { campaign })}`;
      }

      const transcriptFrag = record(
        await this.getActiveByKey(`call.campaign.${campaign}.transcript`),
      );
      const transcriptSchema = record(
        await this.getActiveByKey(`call.campaign.${campaign}.transcript_schema`),
      );
      if (transcriptFrag && transcriptSchema) {
        campaignTranscriptSection = substitute(transcriptFrag.body, { campaign });
        campaignTranscriptSchema = `,\n\n  ${substitute(transcriptSchema.body, { campaign })}`;
      }
    }

    const withSections = substitute(base.body, {
      campaign_section: campaignSection,
      campaign_qa_section: campaignQaSection,
      campaign_qa_schema: campaignQaSchema,
      campaign_transcript_section: campaignTranscriptSection,
      campaign_transcript_schema: campaignTranscriptSchema,
    });

    const prompt = substitute(withSections, {
      transcript,
      campaign: campaign ?? '',
    });

    return { prompt, promptVersions: versions };
  }

  private async resolveCallCampaignSection(
    campaign: string | null | undefined,
    versions: PromptVersions,
  ): Promise<string> {
    const record = (t: PromptTemplate | null) => {
      if (t) versions[t.key] = t.version;
      return t;
    };

    if (!campaign || campaign === 'unknown') {
      const unknown = record(await this.getActiveByKey('call.campaign.unknown'));
      return unknown?.body ?? '';
    }

    const specific = record(
      await this.getActiveByKey(`call.campaign.${campaign}`),
    );
    if (specific) {
      return substitute(specific.body, { campaign });
    }

    const fallback = record(
      await this.getActiveByKey('call.campaign.default'),
    );
    if (fallback) {
      return substitute(fallback.body, { campaign });
    }

    return '';
  }

  async composeChatPrompt(transcript: string, campaign?: string | null) {
    const versions: PromptVersions = {};
    const record = (t: PromptTemplate | null) => {
      if (t) versions[t.key] = t.version;
      return t;
    };

    const base = record(await this.getActiveByKey('chat.base'));
    if (!base) {
      throw new Error(
        'Missing active "chat.base" prompt template — cannot compose chat prompt',
      );
    }

    const campaignLine =
      campaign && campaign !== 'unknown' ? `Campaign context: ${campaign}\n` : '';

    const isRac = !!campaign && RAC_CAMPAIGN_REGEX.test(campaign);

    const opsSection = record(await this.getActiveByKey('chat.operations.default'));
    const opsSchema = record(
      await this.getActiveByKey('chat.operations_schema.default'),
    );

    // Chat response-time metrics are computed in code from the transcript
    // (backend/src/insights/chat-response-time.ts) — no LLM prompt section.

    const racIdleRule = isRac
      ? record(await this.getActiveByKey('chat.rac.idle_rule'))
      : null;
    const racOpportunity = isRac
      ? record(await this.getActiveByKey('chat.rac.opportunity'))
      : null;
    const racQa = isRac ? record(await this.getActiveByKey('chat.rac.qa')) : null;
    const racQaSchema = isRac
      ? record(await this.getActiveByKey('chat.rac.qa_schema'))
      : null;
    const racObjection = isRac
      ? record(await this.getActiveByKey('chat.rac.objection'))
      : null;
    const racObjectionSchema = isRac
      ? record(await this.getActiveByKey('chat.rac.objection_schema'))
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

    const prompt = substitute(withSections, {
      transcript,
      campaign: campaign ?? '',
    });

    return { prompt, promptVersions: versions };
  }

  // CSAT contest assessment prompt: csat.base + the campaign framework
  // (csat.campaign.<CAMPAIGN>, falling back to csat.campaign.default) + the
  // shared csat.schema. Returns the prompt plus the fragment versions used.
  async composeCsatPrompt(
    transcript: string,
    campaign: string | null,
    score: number | null,
    comment: string | null,
  ) {
    const versions: PromptVersions = {};
    const record = (t: PromptTemplate | null) => {
      if (t) versions[t.key] = t.version;
      return t;
    };

    const base = record(await this.getActiveByKey('csat.base'));
    if (!base) {
      throw new Error(
        'Missing active "csat.base" prompt template — cannot compose CSAT prompt',
      );
    }
    const schema = record(await this.getActiveByKey('csat.schema'));

    let framework: PromptTemplate | null = null;
    if (campaign) {
      framework = record(await this.getActiveByKey(`csat.campaign.${campaign}`));
    }
    if (!framework) {
      framework = record(await this.getActiveByKey('csat.campaign.default'));
    }

    const withSections = substitute(base.body, {
      framework_section: framework?.body ?? '',
      schema: schema?.body ?? '',
    });

    const prompt = substitute(withSections, {
      transcript,
      campaign: campaign ?? '',
      csat_score: score == null ? 'not provided' : String(score),
      csat_comment: comment?.trim() ? comment.trim() : 'none provided',
    });

    return { prompt, promptVersions: versions };
  }

  async preview(
    interactionType: 'call' | 'chat',
    campaign?: string | null,
    transcript?: string,
  ) {
    const sampleTranscript =
      transcript ?? '[transcript preview — actual transcript inserted at runtime]';
    const { prompt } =
      interactionType === 'chat'
        ? await this.composeChatPrompt(sampleTranscript, campaign ?? null)
        : await this.composeCallPrompt(sampleTranscript, campaign ?? null);
    return prompt;
  }
}
