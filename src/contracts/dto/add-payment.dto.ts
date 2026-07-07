import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CustomerPaymentType, PayMethod } from '@prisma/client';

export class AddPaymentDto {
  @IsNumber()
  @Min(1)
  amountUzs: number;

  @IsString()
  paidAt: string;

  @IsOptional()
  @IsEnum(CustomerPaymentType)
  type?: CustomerPaymentType;

  /** Касса: CASH | CARD | P2P | BANK */
  @IsOptional()
  @IsEnum(PayMethod)
  method?: PayMethod;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
