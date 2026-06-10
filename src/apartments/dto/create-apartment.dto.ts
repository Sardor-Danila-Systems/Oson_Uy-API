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

export class CreateApartmentDto {
  @ApiProperty({
    required: false,
    default: '',
    description: 'Код блока (пусто — без блока)',
  })
  @IsOptional()
  @IsString()
  sectionKey?: string;

  @ApiProperty({ example: '42' })
  @IsString()
  number: string;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  floor: number;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rooms: number;

  @ApiProperty({ example: 72.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  areaSqm: number;

  @ApiProperty({ required: false, example: 350000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceUzs?: number;

  @ApiProperty({
    required: false,
    example: 9500000,
    description: 'Цена за 1 м². Полная цена = площадь × цена за м²',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerM2Uzs?: number;

  @ApiProperty({ enum: ApartmentStatus, required: false })
  @IsOptional()
  @IsEnum(ApartmentStatus)
  status?: ApartmentStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  layoutImageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  model3dUrl?: string;

  @ApiProperty({
    required: false,
    description: 'Шаблон планировки (FK layout_variants → project_floor_layouts)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  layoutVariantId?: number;

  @ApiProperty({
    required: false,
    description: 'Произвольные CRM-поля (JSON object)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsObject()
  crmMetadata?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
