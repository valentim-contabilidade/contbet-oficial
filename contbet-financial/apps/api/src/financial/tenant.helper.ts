import { ForbiddenException } from '@nestjs/common';
import { Profile } from '@prisma/client';

/**
 * Constrói cláusula WHERE com filtro multi-tenant baseado no perfil do usuário.
 * - ADMIN: vê tudo (filtro opcional por company_id)
 * - MANAGER: só vê dados da própria empresa
 * - OWNER: bloqueado em recursos financeiros (são gerenciais, não operacionais)
 */
export function buildTenantWhere(
  current: { profile: Profile; company_id: string | null; brand_id: string | null },
  baseWhere: any = {},
  options: { allowOwner?: boolean; ownerScope?: 'company' | 'brand' } = {},
) {
  const where = { ...baseWhere, metadeleted: false };

  if (current.profile === Profile.ADMIN) {
    return where;
  }

  if (current.profile === Profile.MANAGER) {
    where.company_id = current.company_id;
    return where;
  }

  if (current.profile === Profile.OWNER) {
    if (!options.allowOwner) {
      throw new ForbiddenException('Owner não tem acesso a este recurso financeiro.');
    }
    where.company_id = current.company_id;
    if (options.ownerScope === 'brand') {
      where.brand_id = current.brand_id;
    }
    return where;
  }

  throw new ForbiddenException();
}

/**
 * Garante que o usuário pode acessar/modificar uma entidade específica.
 */
export function assertTenantAccess(
  entity: { company_id: string; brand_id?: string | null },
  current: { profile: Profile; company_id: string | null; brand_id: string | null },
  options: { allowOwner?: boolean; ownerScope?: 'company' | 'brand' } = {},
) {
  if (current.profile === Profile.ADMIN) return;

  if (current.profile === Profile.MANAGER) {
    if (entity.company_id !== current.company_id) {
      throw new ForbiddenException('Você não tem acesso a este recurso.');
    }
    return;
  }

  if (current.profile === Profile.OWNER) {
    if (!options.allowOwner) {
      throw new ForbiddenException();
    }
    if (entity.company_id !== current.company_id) {
      throw new ForbiddenException();
    }
    if (options.ownerScope === 'brand' && entity.brand_id !== current.brand_id) {
      throw new ForbiddenException();
    }
    return;
  }

  throw new ForbiddenException();
}

/**
 * Determina o company_id correto para criação baseado no perfil.
 */
export function resolveCompanyForCreate(
  dto: { company_id?: string },
  current: { profile: Profile; company_id: string | null },
): string {
  if (current.profile === Profile.ADMIN) {
    if (!dto.company_id) {
      throw new ForbiddenException('Admin deve especificar a empresa.');
    }
    return dto.company_id;
  }
  if (current.profile === Profile.MANAGER) {
    if (dto.company_id && dto.company_id !== current.company_id) {
      throw new ForbiddenException('Você só pode criar para sua empresa.');
    }
    return current.company_id!;
  }
  throw new ForbiddenException();
}
