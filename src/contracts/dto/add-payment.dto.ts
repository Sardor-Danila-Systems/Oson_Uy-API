import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CustomerPaymentType } from '@prisma/client';

export class AddPaymentDto {
  @IsNumber()
  @Min(1)
  amountUzs: number;

  @IsString()
  paidAt: string;

  @IsOptional()
  @IsEnum(CustomerPaymentType)
  type?: CustomerPaymentType;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
