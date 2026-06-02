import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ContractStatus, PaymentMethod } from '@prisma/client';

export class FilterContractDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  managerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
