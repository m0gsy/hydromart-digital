import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { PaymentMethodService } from '../application/services/payment-method.service';
import { PaymentMethodRecord } from '../application/ports/payment-method.repository';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

@ApiTags('Payment methods')
@ApiBearerAuth()
@Controller({ path: 'payment-methods', version: '1' })
export class PaymentMethodController {
  constructor(private readonly methods: PaymentMethodService) {}

  @Get()
  @ApiOperation({ summary: 'List my saved payment methods' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<PaymentMethodRecord[]> {
    return this.methods.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Save a payment method (first becomes default)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodRecord> {
    return this.methods.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my payment methods' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodRecord> {
    return this.methods.update(user.sub, id, dto);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a payment method as default' })
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentMethodRecord> {
    return this.methods.setDefault(user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my payment methods' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.methods.remove(user.sub, id);
  }
}
