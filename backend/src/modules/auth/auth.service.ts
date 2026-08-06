import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import { UserAccount } from '../../db/entities/user-account.entity';
import { TwoFactorService } from '../../infrastructure/common/2fa.service';

import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { OtpCodeDto } from './dto/otp-code.dto';
import { ChangePasswordDto } from '../user/dto/change-password.dto';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '14d';
const SESSION_WINDOW_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserAccount)
    private readonly accountRepo: Repository<UserAccount>,
    private readonly jwt: JwtService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  private static sha256(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private static normalizeOtp(code: unknown) {
    return String(code ?? '').replace(/\s+/g, '');
  }

  private getUserIdFromAuth(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authHeader.slice('Bearer '.length);

    try {
      const payload: any = this.jwt.verify(token);
      return payload.sub as string;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private toUserDto(user: UserAccount) {
    const name =
      user.displayName ||
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      user.email;

    return {
      id: user.id,
      name,
      email: user.email,
      roleId: user.roleId ?? null,
      clientId: user.clientId ?? null,
      tagList: user.tagList ?? null,
    };
  }

  private issueAccessToken(user: UserAccount, amr: string[] = ['pwd']) {
    return this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        roleId: user.roleId ?? null,
        clientId: user.clientId ?? null,
        amr,
      },
      { expiresIn: ACCESS_TTL },
    );
  }

  private issueRefreshToken(user: UserAccount) {
    return this.jwt.sign(
      { sub: user.id, stage: 'refresh' },
      { expiresIn: REFRESH_TTL },
    );
  }

  private issueTwoFactorToken(user: UserAccount) {
    return this.jwt.sign(
      { sub: user.id, stage: '2fa' },
      { expiresIn: ACCESS_TTL },
    );
  }

  private async persistSession(user: UserAccount, refreshToken: string) {
    user.sessionExpiresAt = new Date(Date.now() + SESSION_WINDOW_MS);
    user.lastSeenAt = new Date();
    user.lastLoggedInDate = new Date();
    user.refreshTokenHash = AuthService.sha256(refreshToken);

    await this.accountRepo.save(user);
  }

  async login(dto: LoginDto) {
    const { email, id, password } = dto;

    if (!password || (!email && !id)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = id
      ? await this.accountRepo.findOne({ where: { id } })
      : await this.accountRepo.findOne({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let ok = false;

    try {
      ok = await bcrypt.compare(password, user.passwordHash);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.twoFactorEnabled) {
      const twoFactorToken = this.issueTwoFactorToken(user);
      return {
        twoFactorRequired: true,
        twoFactorToken,
      };
    }

    const accessToken = this.issueAccessToken(user, ['pwd']);
    const refreshToken = this.issueRefreshToken(user);

    await this.persistSession(user, refreshToken);

    return {
      twoFactorRequired: false,
      accessToken,
      refreshToken,
      user: this.toUserDto(user),
    };
  }

  async refresh(dto: RefreshDto) {
    const token = dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }

    let payload: any;

    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Refresh token expired/invalid');
    }

    if (payload.stage !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token stage');
    }

    const userId = payload.sub as string;
    const user = await this.accountRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid user');
    }

    if (
      !user.sessionExpiresAt ||
      user.sessionExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Session expired');
    }

    if (
      !user.refreshTokenHash ||
      user.refreshTokenHash !== AuthService.sha256(token)
    ) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    user.sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    user.lastSeenAt = new Date();

    await this.accountRepo.save(user);

    const accessToken = this.issueAccessToken(user);

    return { accessToken };
  }

  async me(auth?: string) {
    const userId = this.getUserIdFromAuth(auth);
    const user = await this.accountRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return this.toUserDto(user);
  }

  async changeMyPassword(auth: string, dto: ChangePasswordDto) {
    const userId = this.getUserIdFromAuth(auth);
    const user = await this.accountRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('No password set');
    }

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.modifiedById = userId;

    await this.accountRepo.save(user);
    return { ok: true };
  }

  async verify2fa(dto: Verify2faDto) {
    const { twoFactorToken, code } = dto;

    let payload: any;
    try {
      payload = this.jwt.verify(twoFactorToken);
    } catch {
      throw new UnauthorizedException('2FA token expired/invalid');
    }

    if (payload.stage !== '2fa') {
      throw new UnauthorizedException('Invalid 2FA stage');
    }

    const userId = payload.sub as string;

    const ok = await this.twoFactorService.verifyCode(
      userId,
      AuthService.normalizeOtp(code),
    );

    if (!ok) {
      throw new UnauthorizedException('Invalid code');
    }

    const user = await this.accountRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid user');
    }

    const accessToken = this.issueAccessToken(user, ['pwd', 'mfa']);
    const refreshToken = this.issueRefreshToken(user);

    await this.persistSession(user, refreshToken);

    return {
      twoFactorRequired: false,
      accessToken,
      refreshToken,
      user: this.toUserDto(user),
    };
  }

  async setup2fa(auth?: string) {
    const userId = this.getUserIdFromAuth(auth);
    return this.twoFactorService.beginSetup(userId);
  }

  async confirm2fa(auth: string, dto: OtpCodeDto) {
    const userId = this.getUserIdFromAuth(auth);
    return this.twoFactorService.confirmSetup(
      userId,
      AuthService.normalizeOtp(dto.code),
    );
  }

  async twoFaStatus(auth?: string) {
    const userId = this.getUserIdFromAuth(auth);
    const user = await this.accountRepo.findOne({ where: { id: userId } });

    return {
      enabled: !!user?.twoFactorEnabled,
      confirmedAt: user?.twoFactorConfirmedAt ?? null,
    };
  }

  async disable2fa(auth: string, dto: OtpCodeDto) {
    const userId = this.getUserIdFromAuth(auth);

    const ok = await this.twoFactorService.verifyCode(
      userId,
      AuthService.normalizeOtp(dto.code),
    );

    if (!ok) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.accountRepo.update(
      { id: userId },
      {
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        twoFactorConfirmedAt: null,
      },
    );

    return { disabled: true };
  }

  async reset2fa(auth: string, dto: OtpCodeDto) {
    const userId = this.getUserIdFromAuth(auth);

    const ok = await this.twoFactorService.verifyCode(
      userId,
      AuthService.normalizeOtp(dto.code),
    );

    if (!ok) {
      throw new UnauthorizedException('Invalid code');
    }

    return this.twoFactorService.beginSetup(userId);
  }
}
