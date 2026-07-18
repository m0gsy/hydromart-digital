import { Injectable } from '@nestjs/common';

import { FavoriteRepository } from '../../application/ports/favorite.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class FavoritePrismaRepository implements FavoriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listProductIds(customerId: string): Promise<string[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  async add(customerId: string, productId: string): Promise<void> {
    // skipDuplicates makes a re-add of an existing (customerId, productId) a no-op.
    await this.prisma.favorite.createMany({
      data: [{ customerId, productId }],
      skipDuplicates: true,
    });
  }

  async remove(customerId: string, productId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { customerId, productId } });
  }
}
