import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TranscriptionOpenAiService } from './transcriptionOpenAi.service';
import { TranscriptionDeepgramService } from './transcriptionDeepgram.service';
import { TranscriptionVocabService } from './transcription-vocab.service';

@Controller('uiapi/transcription')
export class TranscriptionController {
  constructor(
    private readonly svcOa: TranscriptionOpenAiService,
    private readonly svcDg: TranscriptionDeepgramService,
    private readonly vocab: TranscriptionVocabService,
  ) {}

  // ─── editable vehicle vocabulary (keyterms + replacements) ─────────────────
  @Get('vocab')
  listVocab() {
    return this.vocab.list();
  }

  @Post('vocab')
  addVocab(@Body() body: { kind?: string; term?: string; replaceWith?: string }) {
    const kind = body?.kind === 'replacement' ? 'replacement' : 'keyterm';
    return this.vocab.add(kind, body?.term ?? '', body?.replaceWith);
  }

  // Master on/off switch (declared before vocab/:id so 'settings' isn't an id).
  @Get('vocab/settings')
  getVocabSettings() {
    return this.vocab.getSettings();
  }

  @Patch('vocab/settings')
  setVocabSettings(@Body() body: { keyterms?: boolean; replacements?: boolean }) {
    return this.vocab.setSettings({ keyterms: body?.keyterms, replacements: body?.replacements });
  }

  @Patch('vocab/:id')
  setVocabActive(@Param('id') id: string, @Body() body: { active?: boolean }) {
    return this.vocab.setActive(id, body?.active !== false);
  }

  @Delete('vocab/:id')
  removeVocab(@Param('id') id: string) {
    return this.vocab.remove(id);
  }

  @Post('call')
  @UseInterceptors(FileInterceptor('file'))
  async transcribeCall(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Missing file field "file"');
    const result = await this.svcOa.transcribeBuffer(file);
    return result; // { text, ... }
  }

  @Post('call-url')
  async transcribeCallUrl(@Body() body: { url?: string }) {
    if (!body?.url) throw new BadRequestException('Missing body field "url"');
    return this.svcDg.transcribeUrl(body.url);
  }
}
