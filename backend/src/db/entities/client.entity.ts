import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A client (tenant) whose data is scoped and protected from every other
 * client's — e.g. NMGB (Nissan) and RAC. Referenced by app.interactions,
 * app.insight_summaries and app.account (for the 'client' role), rather than
 * duplicated onto every table that already joins back to interactions.
 */
@Entity({ name: 'clients', schema: 'app' })
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 100 })
  name!: string;

  // Short, stable, URL/code-friendly identifier (e.g. 'nmgb', 'rac') — used in
  // seed/migration scripts and anywhere a human-readable constant is clearer
  // than a uuid, without being the actual foreign key.
  @Column({ type: 'varchar', length: 50, unique: true })
  key!: string;

  @Column({ type: 'bit', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
