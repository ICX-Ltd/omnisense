import { Column, Entity } from 'typeorm';
import { Expose } from 'class-transformer';
import { BaseEntity } from '../base.entity';
import { JsonTransformer } from '../json.transformer';

@Entity({ name: 'account', schema: 'app' })
export class UserAccount extends BaseEntity {
  @Column({ type: 'nvarchar', name: 'reference', nullable: true, length: 256 })
  reference?: string | null;

  @Column({
    type: 'nvarchar',
    name: 'display_name',
    nullable: true,
    length: 128,
  })
  displayName?: string | null;

  @Column({ type: 'nvarchar', name: 'first_name', nullable: true, length: 64 })
  firstName?: string | null;

  @Column({ type: 'nvarchar', name: 'last_name', nullable: true, length: 64 })
  lastName?: string | null;

  @Column({ type: 'nvarchar', name: 'job_title', nullable: true, length: 64 })
  jobTitle?: string | null;

  @Column({
    type: 'nvarchar',
    name: 'mobile_phone',
    nullable: true,
    length: 128,
  })
  mobilePhone?: string | null;

  @Column({ type: 'nvarchar', name: 'email', nullable: false, length: 256 })
  email: string;

  @Column({ type: 'nvarchar', name: 'role_id', length: 50, nullable: true })
  roleId?: string | null;

  // Which client this account belongs to — required when roleId is 'client'
  // (enforced in UserService), null for every internal role. Determines the
  // one client's data a 'client'-role user can ever see; never overridable by
  // the user themselves (only an admin's "view as" can substitute a different
  // client, and only for their OWN preview session).
  @Column({ type: 'uniqueidentifier', name: 'client_id', nullable: true })
  clientId?: string | null;

  @Column({ type: 'datetime2', name: 'last_login_date', nullable: true })
  lastLoggedInDate?: Date | null;

  @Column({
    type: 'nvarchar',
    name: 'password_hash',
    nullable: true,
    length: 255,
  })
  passwordHash?: string | null;

  @Column({ type: 'bit', name: 'twoFactorEnabled', default: false })
  twoFactorEnabled: boolean;

  @Column({
    type: 'nvarchar',
    name: 'twoFactorSecretEnc',
    length: 512,
    nullable: true,
  })
  twoFactorSecretEnc?: string | null;

  @Column({
    type: 'datetimeoffset',
    name: 'twoFactorConfirmedAt',
    nullable: true,
  })
  twoFactorConfirmedAt?: Date | null;

  @Column({
    type: 'nvarchar',
    name: 'tag_list',
    length: 'MAX',
    nullable: true,
    transformer: JsonTransformer,
  })
  tagList?: Record<string, any> | null;

  @Column({ type: 'datetime2', name: 'session_expires_at', nullable: true })
  sessionExpiresAt?: Date | null;

  @Column({ type: 'datetime2', name: 'last_seen_at', nullable: true })
  lastSeenAt?: Date | null;

  @Column({
    type: 'nvarchar',
    name: 'refresh_token_hash',
    length: 200,
    nullable: true,
  })
  refreshTokenHash?: string | null;

  @Expose()
  get initials() {
    return `${(this.firstName || '').charAt(0)}${(this.lastName || '').charAt(0)}`;
  }
}
