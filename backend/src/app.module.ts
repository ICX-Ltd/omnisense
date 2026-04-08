import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envSchema } from './env.validation';

import { TranscriptionModule } from './transcription/transcription.module';
import { InsightsModule } from './insights/insights.module';
import { RecordingsModule } from './recordings/recordings.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';

import { Interaction } from './db/entities/interaction.entity';
import { InteractionTranscript } from './db/entities/interaction-transcript.entity';
import { InteractionInsight } from './db/entities/interaction-insight.entity';
import { InsightSummary } from './db/entities/insight-summary.entity';
import { UserAccount } from './db/entities/user-account.entity';
import { BatchJob } from './db/entities/batch-job.entity';
import { SurveyResponse } from './db/entities/survey-response.entity';

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
    TranscriptionModule,
    InsightsModule,
    RecordingsModule,
  ],
})
export class AppModule {}
