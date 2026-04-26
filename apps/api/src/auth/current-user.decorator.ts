import { createParamDecorator, ExecutionContext, SetMetadata, CanActivate, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Profile } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);

export const PROFILES_KEY = 'profiles';
export const Profiles = (...profiles: Profile[]) => SetMetadata(PROFILES_KEY, profiles);

@Injectable()
export class ProfilesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Profile[]>(PROFILES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = ctx.switchToHttp().getRequest();
    if (!user || !required.includes(user.profile)) {
      throw new ForbiddenException('Acesso negado para este perfil.');
    }
    return true;
  }
}
