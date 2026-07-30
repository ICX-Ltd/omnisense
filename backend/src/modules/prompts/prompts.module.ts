import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PromptTemplate } from '../../db/entities/prompt-template.entity';
import { PromptTemplateHistory } from '../../db/entities/prompt-template-history.entity';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromptTemplate, PromptTemplateHistory]),
    JwtSharedModule,
  ],
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
