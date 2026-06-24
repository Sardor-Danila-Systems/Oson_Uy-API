import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApartmentStatus, RenovationState } from '@prisma/client';

export class BulkUpdateApartmentsDto {
  // ── Filter (at least one required) ──────────────────────────────────────────
  @ApiProperty({ required: false, description: 'Блок (секция)' })
  @IsOptional()
  @IsString()
  sectionKey?: string;

  @ApiProperty({ required: false, description: 'Этаж' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  apartmentIds?: number[];

  // ── Fields to apply ─────────────────────────────────────────────────────────
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

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerM2Uzs?: number | null;

  @ApiProperty({ enum: ApartmentStatus, required: false })
  @IsOptional()
  @IsEnum(ApartmentStatus)
  status?: ApartmentStatus;

  @ApiProperty({ enum: RenovationState, required: false })
  @IsOptional()
  @IsEnum(RenovationState)
  renovationState?: RenovationState;

  @ApiProperty({ required: false, description: 'URL планировки (применить ко всем)' })
  @IsOptional()
  @IsString()
  layoutImageUrl?: string | null;
}

export class DeleteSectionDto {
  @ApiProperty({ description: 'Блок (секция) для удаления; пусто = блок без кода' })
  @IsString()
  sectionKey: string;
}
