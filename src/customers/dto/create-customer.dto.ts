import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @MinLength(5)
  phone: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  apartmentId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalPriceUzs?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    required: false,
    description: 'Сумма к оплате в текущем месяце (UZS), задаётся застройщиком',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyDueUzs?: number | null;

  // ── Паспортные / контактные данные покупателя ──────────────────────────────

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  passportSeries?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  passportNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  passportIssuedBy?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  pinfl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  email?: string;
}
