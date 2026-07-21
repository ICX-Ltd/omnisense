import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InsightCorrection } from '../db/entities/insight-correction.entity';

@Injectable()
export class CorrectionsService {
  constructor(
    @InjectRepository(InsightCorrection)
    private readonly repo: Repository<InsightCorrection>,
  ) {}

  list(recordingId: string) {
    return this.repo.find({
      where: { recordingId },
      order: { createdAt: 'DESC' },
    });
  }

  add(
    recordingId: string,
    body: {
      fieldKey?: string;
      fieldLabel?: string;
      aiValue?: string | null;
      correctedValue?: string | null;
      note?: string | null;
      correctedBy?: string | null;
    },
  ) {
    if (!recordingId) throw new BadRequestException('recordingId is required');
    if (!body?.fieldKey?.trim()) throw new BadRequestException('fieldKey is required');
    if (
      (body.correctedValue == null || body.correctedValue === '') &&
      (body.note == null || body.note === '')
    ) {
      throw new BadRequestException('a corrected value or a note is required');
    }
    return this.repo.save(
      this.repo.create({
        recordingId,
        fieldKey: body.fieldKey.trim(),
        fieldLabel: (body.fieldLabel ?? body.fieldKey).trim(),
        aiValue: body.aiValue ?? null,
        correctedValue: body.correctedValue ?? null,
        note: body.note ?? null,
        correctedBy: body.correctedBy?.trim() || null,
      }),
    );
  }

  remove(id: string) {
    return this.repo.delete(id).then(() => ({ ok: true }));
  }
}
