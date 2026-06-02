import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ContractStatus, PaymentMethod } from '@prisma/client';

export class CreateContractDto {
  @IsInt()
  apartmentId: number;

  @IsInt()
  customerId: number;

  @IsOptional()
  @IsInt()
  managerId?: number;

  @IsOptional()
  @IsInt()
  brokerId?: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsNumber()
  @Min(0)
  totalPriceUzs: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsNumber()
  @Min(0)
  firstPaymentUzs: number;

  @IsInt()
  @Min(1)
  termMonths: number;

  @IsOptional()
  @IsString()
  contractDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
