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

  // Two independent switches, stored as config rows' `active` flags:
  //   apply_keyterms     — recognition biasing (default OFF; over-eager, can
  //                        rewrite uncertain audio as vehicle models)
  //   apply_replacements — exact whole-word swaps like Duke→Juke (default ON;
  //                        surgical, only rewrites that literal word)
  // Env DEEPGRAM_APPLY_VOCAB=false is a hard kill-switch for both.
  private async flag(term: string, def: boolean): Promise<boolean> {
    if (process.env.DEEPGRAM_APPLY_VOCAB === 'false') return false;
    try {
      const row = await this.repo.findOne({ where: { kind: 'config' as any, term } });
      return row ? row.active : def;
    } catch {
      return false;
    }
  }

  async getSettings(): Promise<{ keyterms: boolean; replacements: boolean }> {
    return {
      keyterms: await this.flag('apply_keyterms', false),
      replacements: await this.flag('apply_replacements', true),
    };
  }

  private async setFlag(term: string, active: boolean) {
    const existing = await this.repo.findOne({ where: { kind: 'config' as any, term } });
    if (existing) {
      existing.active = active;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ kind: 'config' as any, term, replaceWith: null, active }));
    }
  }

  async setSettings(s: { keyterms?: boolean; replacements?: boolean }) {
    if (typeof s.keyterms === 'boolean') await this.setFlag('apply_keyterms', s.keyterms);
    if (typeof s.replacements === 'boolean') await this.setFlag('apply_replacements', s.replacements);
    this.invalidate();
    return this.getSettings();
  }

  // The active vocabulary the Deepgram service should apply, each half gated by
  // its own switch (empty half = not applied).
  async getActive(): Promise<{ keyterms: string[]; replacements: [string, string][] }> {
    if (this.cache && Date.now() - this.cache.at < this.TTL_MS) return this.cache;
    const { keyterms: ktOn, replacements: rpOn } = await this.getSettings();
    try {
      const all = ktOn || rpOn ? await this.repo.find({ where: { active: true } }) : [];
      const keyterms = ktOn
        ? all.filter((r) => r.kind === 'keyterm' && r.term?.trim()).map((r) => r.term.trim())
        : [];
      const replacements = rpOn
        ? all
            .filter((r) => r.kind === 'replacement' && r.term?.trim() && r.replaceWith?.trim())
            .map((r) => [r.term.trim(), r.replaceWith!.trim()] as [string, string])
        : [];
      this.cache = { keyterms, replacements, at: Date.now() };
      return this.cache;
    } catch (e: any) {
      this.logger.warn(`Vocab load failed, applying none: ${e?.message ?? e}`);
      return { keyterms: [], replacements: [] };
    }
  }

  // Only the editable vocabulary rows (excludes the config/settings row).
  async list() {
    const rows = await this.repo.find({ order: { kind: 'ASC', term: 'ASC' } });
    return rows.filter((r) => r.kind === 'keyterm' || r.kind === 'replacement');
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
