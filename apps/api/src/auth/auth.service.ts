import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15min

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });

    if (!user || user.metadeleted || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Conta temporariamente bloqueada por tentativas excessivas.');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const failed = user.failed_logins + 1;
      const shouldLock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failed_logins: failed,
          locked_until: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
        },
      });
      await this.audit.log('LOGIN_FAILED', 'USER', user.id, user.id, { username });
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // reset failed counts
    if (user.failed_logins > 0 || user.locked_until) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failed_logins: 0, locked_until: null },
      });
    }

    await this.audit.log('LOGIN', 'USER', user.id, user.id);

    const payload = { sub: user.id, profile: user.profile, company_id: user.company_id, brand_id: user.brand_id };
    const access_token = await this.jwt.signAsync(payload);

    const { password_hash, failed_logins, locked_until, ...safe } = user;
    return { access_token, user: safe };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.metadeleted) throw new UnauthorizedException();
    const { password_hash, failed_logins, locked_until, ...safe } = user;
    return safe;
  }

  async hashPassword(plain: string) {
    if (!plain || plain.length < 6) throw new BadRequestException('Senha mínima de 6 caracteres');
    return bcrypt.hash(plain, 10);
  }
}
