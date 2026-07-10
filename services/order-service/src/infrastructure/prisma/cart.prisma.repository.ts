import { Injectable } from '@nestjs/common';

import { CartItemRecord, CartRepository } from '../../application/ports/cart.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class CartPrismaRepository implements CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCustomer(customerId: string): Promise<CartItemRecord[]> {
    return this.prisma.cartItem.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findItem(customerId: string, productId: string): Promise<CartItemRecord | null> {
    return this.prisma.cartItem.findUnique({
      where: { customerId_productId: { customerId, productId } },
    });
  }

  async upsert(customerId: string, productId: string, quantity: number): Promise<CartItemRecord> {
    return this.prisma.cartItem.upsert({
      where: { customerId_productId: { customerId, productId } },
      create: { customerId, productId, quantity },
      update: { quantity },
    });
  }

  async remove(customerId: string, productId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { customerId, productId } });
  }

  async clear(customerId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { customerId } });
  }
}
