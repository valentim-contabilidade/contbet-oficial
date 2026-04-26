import { Module, Global, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(action: string, entity: string, entity_id?: string, user_id?: string, metadata?: any) {
    try {
      await this.prisma.auditLog.create({
        data: { action, entity, entity_id, user_id, metadata },
      });
    } catch (e) {
      console.error('Audit log failed:', e);
    }
  }

  async list(filters: { entity?: string; user_id?: string; limit?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filters.entity && { entity: filters.entity }),
        ...(filters.user_id && { user_id: filters.user_id }),
      },
      orderBy: { timestamp: 'desc' },
      take: filters.limit ?? 100,
    });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
