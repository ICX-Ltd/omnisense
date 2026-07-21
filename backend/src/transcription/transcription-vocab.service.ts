import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TranscriptionVocab } from '../db/entities/transcription-vocab.entity';
import { VEHICLE_KEYTERMS, VEHICLE_REPLACEMENTS } from './vehicle-vocab';

// Runtime-editable transcription vocabulary. Seeds from the hardcoded defaults
// on first boot, serves the active set to the Deepgram service (short cache +
// fallback to the defaults if the table is empty/unavailable), and exposes CRUD
// so the vocabulary can be changed from the UI without a deploy.
@Injectable()
export class TranscriptionVocabService {
  private readonly logger = new Logger(TranscriptionVocabService.name);
  private cache: { keyterms: string[]; replacements: [string, string][]; at: number } | null = null;
  private readonly TTL_MS = 60_000;

  constructor(
    @InjectRepository(TranscriptionVocab)
    private readonly repo: Repository<TranscriptionVocab>,
  ) {}

  async onModuleInit() {
    try {
      await this.seedIfEmpty();
    } catch (e: any) {
      this.logger.warn(
        `Transcription vocab seed skipped — run sql/add-transcription-vocab.sql. Reason: ${e?.message ?? e}`,
      );
    }
  }

  private async seedIfEmpty() {
    const count = await this.repo.count();
    if (count > 0) return;
    const rows: TranscriptionVocab[] = [
      ...VEHICLE_KEYTERMS.map((t) =>
        this.repo.create({ kind: 'keyterm', term: t, replaceWith: null, active: true }),
      ),
      ...VEHICLE_REPLACEMENTS.map(([from, to]) =>
        this.repo.create({ kind: 'replacement', term: from, replaceWith: to, active: true }),
      ),
    ];
    await this.repo.save(rows);
    this.logger.log(`Seeded ${rows.length} transcription vocab rows from defaults.`);
  }

  private invalidate() {
    this.cache = null;
  }

  // The active vocabulary the Deepgram service should apply. Falls back to the
  // hardcoded defaults if the table is empty or the query fails, so transcription
  // never loses its vehicle biasing.
  async getActive(): Promise<{ keyterms: string[]; replacements: [string, string][] }> {
    if (this.cache && Date.now() - this.cache.at < this.TTL_MS) return this.cache;
    try {
      const all = await this.repo.find({ where: { active: true } });
      const keyterms = all
        .filter((r) => r.kind === 'keyterm' && r.term?.trim())
        .map((r) => r.term.trim());
      const replacements = all
        .filter((r) => r.kind === 'replacement' && r.term?.trim() && r.replaceWith?.trim())
        .map((r) => [r.term.trim(), r.replaceWith!.trim()] as [string, string]);
      if (!keyterms.length && !replacements.length) {
        return { keyterms: VEHICLE_KEYTERMS, replacements: VEHICLE_REPLACEMENTS };
      }
      this.cache = { keyterms, replacements, at: Date.now() };
      return this.cache;
    } catch (e: any) {
      this.logger.warn(`Vocab load failed, using defaults: ${e?.message ?? e}`);
      return { keyterms: VEHICLE_KEYTERMS, replacements: VEHICLE_REPLACEMENTS };
    }
  }

  list() {
    return this.repo.find({ order: { kind: 'ASC', term: 'ASC' } });
  }

  async add(kind: 'keyterm' | 'replacement', term: string, replaceWith?: string) {
    const t = (term || '').trim();
    if (!t) throw new BadRequestException('term is required');
    if (kind !== 'keyterm' && kind !== 'replacement') {
      throw new BadRequestException("kind must be 'keyterm' or 'replacement'");
    }
    if (kind === 'replacement' && !(replaceWith || '').trim()) {
      throw new BadRequestException('replaceWith is required for a replacement');
    }
    const row = await this.repo.save(
      this.repo.create({
        kind,
        term: t,
        replaceWith: kind === 'replacement' ? (replaceWith || '').trim() : null,
        active: true,
      }),
    );
    this.invalidate();
    return row;
  }

  async setActive(id: string, active: boolean) {
    await this.repo.update(id, { active });
    this.invalidate();
    return { ok: true };
  }

  async remove(id: string) {
    await this.repo.delete(id);
    this.invalidate();
    return { ok: true };
  }
}
