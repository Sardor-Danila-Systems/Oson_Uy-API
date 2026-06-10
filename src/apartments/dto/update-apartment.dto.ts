import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApartmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateApartmentDto {
  @ApiProperty({ required: false, description: 'Код блока' })
  @IsOptional()
  @IsString()
  sectionKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rooms?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  areaSqm?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceUzs?: number | null;

  @ApiProperty({
    required: false,
    description: 'Цена за 1 м². Полная цена пересчитается = площадь × цена за м²',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerM2Uzs?: number | null;

  @ApiProperty({ enum: ApartmentStatus, required: false })
  @IsOptional()
  @IsEnum(ApartmentStatus)
  status?: ApartmentStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  layoutImageUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  model3dUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  layoutVariantId?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'CRM JSON; null очищает поле',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsObject()
  crmMetadata?: Record<string, unknown> | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
