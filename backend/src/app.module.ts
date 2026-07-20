import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envSchema } from './env.validation';

import { TranscriptionModule } from './transcription/transcription.module';
import { InsightsModule } from './insights/insights.module';
import { RecordingsModule } from './recordings/recordings.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { HealthModule } from './health/health.module';

import { Interaction } from './db/entities/interaction.entity';
import { InteractionTranscript } from './db/entities/interaction-transcript.entity';
import { InteractionInsight } from './db/entities/interaction-insight.entity';
import { InsightSummary } from './db/entities/insight-summary.entity';
import { UserAccount } from './db/entities/user-account.entity';
import { BatchJob } from './db/entities/batch-job.entity';
import { SurveyResponse } from './db/entities/survey-response.entity';
import { PromptTemplate } from './db/entities/prompt-template.entity';
import { PromptTemplateHistory } from './db/entities/prompt-template-history.entity';
import { LlmUsageLog } from './db/entities/llm-usage-log.entity';
import { TranscriptionUsageLog } from './db/entities/transcription-usage-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const opts = {
          type: 'mssql' as const,
          host: cfg.get('DATABASE_HOST', '127.0.0.1'),
          port: parseInt(cfg.get('DATABASE_PORT', '1433'), 10),
          username: cfg.get('DATABASE_USER'),
          password: cfg.get('DATABASE_PASSWORD'),
          database: cfg.get('DATABASE_NAME', 'ai_assist'),
          entities: [
            Interaction,
            InteractionTranscript,
            InteractionInsight,
            InsightSummary,
            UserAccount,
            BatchJob,
            SurveyResponse,
            PromptTemplate,
            PromptTemplateHistory,
            LlmUsageLog,
            TranscriptionUsageLog,
          ],
          synchronize: false,
          logging: false,
          options: {
            encrypt: true,
            trustServerCertificate: true,
            enableArithAbort: true,
          },
        };

        if (opts.type !== 'mssql') throw new Error('NOT MSSQL!');
        return opts;
      },
    }),

    AuthModule,
    UserModule,
    PromptsModule,
    HealthModule,
    TranscriptionModule,
    InsightsModule,
    RecordingsModule,
  ],
})
export class AppModule {}
