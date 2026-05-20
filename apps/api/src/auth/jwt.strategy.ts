import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { brand_assignments: { select: { brand_id: true } } },
    });
    if (!user || user.metadeleted || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }
    const brandIds = user.brand_assignments.map((a) => a.brand_id);
    return {
      id: user.id,
      profile: user.profile,
      company_id: user.company_id,
      brand_id: user.brand_id,
      // Marcas via N:N. Se vazio e brand_id setado, será usado como fallback.
      brand_ids: brandIds,
    };
  }
}
