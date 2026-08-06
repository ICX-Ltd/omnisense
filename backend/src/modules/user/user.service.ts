import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { UserAccount } from '../../db/entities/user-account.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { ROLE_IDS, normaliseRole } from './roles';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserAccount)
    private readonly accountRepo: Repository<UserAccount>,
    private readonly jwt: JwtService,
  ) {}

  // Mirrors HealthService.requireRole — same Bearer/roleId shape, but also hands
  // back the caller's id so we can stamp modified_by_id on the reset.
  requireRole(authHeader: string | undefined, allowed: string[]) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    let payload: any;
    try {
      payload = this.jwt.verify(authHeader.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const roleId = String(payload.roleId ?? '')
      .trim()
      .toLowerCase();

    if (!allowed.includes(roleId)) {
      throw new ForbiddenException('Insufficient role');
    }

    return { userId: payload.sub as string, roleId };
  }

  private toUserDto(user: UserAccount) {
    const name =
      user.displayName ||
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      user.email;

    return {
      id: user.id,
      reference: user.reference ?? null,
      displayName: user.displayName ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      name,
      jobTitle: user.jobTitle ?? null,
      mobilePhone: user.mobilePhone ?? null,
      email: user.email,
      roleId: user.roleId ?? null,
      clientId: user.clientId ?? null,
      lastLoggedInDate: user.lastLoggedInDate ?? null,
      twoFactorEnabled: !!user.twoFactorEnabled,
      twoFactorConfirmedAt: user.twoFactorConfirmedAt ?? null,
      tagList: user.tagList ?? null,
      sessionExpiresAt: user.sessionExpiresAt ?? null,
      lastSeenAt: user.lastSeenAt ?? null,
      active: (user as any).active ?? true,
      createdAt: (user as any).createdAt ?? null,
      modifiedAt: (user as any).modifiedAt ?? null,
    };
  }

  async findAll() {
    const users = await this.accountRepo.find({
      order: { email: 'ASC' },
    });

    return users.map((u) => this.toUserDto(u));
  }

  async findOne(id: string) {
    const user = await this.accountRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserDto(user);
  }

  /**
   * Changes a user's role.
   *
   * Refuses to change your OWN role: demoting yourself is the one change that
   * cannot be undone through the UI, because you would immediately lose the
   * access needed to reverse it. Someone else with dev/admin has to do it.
   */
  async updateRole(
    id: string,
    roleId: string,
    actingUserId: string,
    clientId?: string,
  ) {
    const user = await this.accountRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const next = normaliseRole(roleId);
    if (!next) {
      throw new BadRequestException(
        `Unknown role "${roleId}". Known roles: ${ROLE_IDS.join(', ')}.`,
      );
    }

    if (id === actingUserId && user.roleId !== next) {
      throw new BadRequestException(
        'You cannot change your own role — ask another admin, otherwise a ' +
          'demotion would lock you out of reversing it.',
      );
    }

    // A 'client'-role account must be tied to exactly one client — that's the
    // whole enforcement mechanism for what data it can ever see.
    const nextClientId = next === 'client' ? clientId ?? user.clientId : null;
    if (next === 'client' && !nextClientId) {
      throw new BadRequestException('clientId is required for the client role');
    }

    await this.accountRepo.update(id, { roleId: next, clientId: nextClientId });
    return this.findOne(id);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.accountRepo.findOne({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('A user with that email already exists');
    }

    if (dto.roleId === 'client' && !dto.clientId) {
      throw new BadRequestException('clientId is required for the client role');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = this.accountRepo.create({
      email: dto.email,
      displayName: dto.displayName ?? dto.email,
      firstName: (dto as any).firstName ?? null,
      lastName: (dto as any).lastName ?? null,
      jobTitle: (dto as any).jobTitle ?? null,
      mobilePhone: (dto as any).mobilePhone ?? null,
      roleId: (dto as any).roleId ?? null,
      clientId: (dto as any).roleId === 'client' ? dto.clientId : null,
      tagList: (dto as any).tagList ?? null,
      passwordHash,
      twoFactorEnabled: false,
      twoFactorSecretEnc: null,
      twoFactorConfirmedAt: null,
      refreshTokenHash: null,
      sessionExpiresAt: null,
      lastSeenAt: null,
    });

    const saved = await this.accountRepo.save(user);
    return this.toUserDto(saved);
  }

  // Admin reset of *another* user's password. No current-password check (that is
  // what makes it a reset) — the gate is the caller's role, enforced in the
  // controller. Any live session for the target is torn down so the old password
  // and refresh token stop working immediately.
  async adminResetPassword(
    id: string,
    dto: AdminResetPasswordDto,
    actorId: string,
  ) {
    const user = await this.accountRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.refreshTokenHash = null;
    user.sessionExpiresAt = null;
    user.lastSeenAt = null;
    user.modifiedById = actorId;

    const saved = await this.accountRepo.save(user);

    return {
      ok: true,
      user: this.toUserDto(saved),
    };
  }

  async deactivate(id: string) {
    const user = await this.accountRepo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if ('active' in user) {
      (user as any).active = false;
    }

    user.refreshTokenHash = null;
    user.sessionExpiresAt = null;
    user.lastSeenAt = null;

    const saved = await this.accountRepo.save(user);

    return {
      ok: true,
      user: this.toUserDto(saved),
    };
  }
}
