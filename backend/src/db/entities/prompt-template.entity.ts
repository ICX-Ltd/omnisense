import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PromptInteractionType = 'call' | 'chat' | 'shared';

export type PromptKind =
  | 'base'
  | 'campaign_section'
  | 'opportunity_section'
  | 'operations_section'
  | 'operations_schema'
  | 'qa_section'
  | 'qa_schema'
  | 'transcript_section'
  | 'transcript_schema'
  | 'objection_section'
  | 'objection_schema'
  | 'other';

@Entity({ name: 'prompt_templates', schema: 'app' })
@Index(['interactionType', 'kind'])
export class PromptTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Unique lookup key — e.g. "call.base", "call.campaign.MFS",
  // "chat.operations.default", "chat.rac.qa"
  @Column({ type: 'varchar', length: 200, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 16 })
  interactionType!: PromptInteractionType;

  @Column({ type: 'varchar', length: 50 })
  kind!: PromptKind;

  // Campaign this fragment applies to (e.g. 'MFS', 'RAC'). Null for shared
  // fragments like the base template.
  @Column({ type: 'varchar', length: 100, nullable: true })
  campaign!: string | null;

  // Short human label shown in the list view
  @Column({ type: 'nvarchar', length: 200 })
  label!: string;

  // Optional notes for editors
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true })
  notes!: string | null;

  // The prompt text. May contain {{placeholders}} resolved by the composer.
  @Column({ type: 'nvarchar', length: 'MAX' })
  body!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'bit', default: true })
  isActive!: boolean;

  @Column({ type: 'uniqueidentifier', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
