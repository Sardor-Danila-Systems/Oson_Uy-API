import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BulkSectionDto {
  @ApiProperty({
    example: 'A',
    description:
      'Код блока/корпуса (латиница/цифры). Если в запросе несколько блоков — обязателен у каждого.',
  })
  @IsString()
  sectionKey: string;

  @ApiProperty({
    required: false,
    example: 'Корпус А',
    description: 'Подпись для CRM (опционально)',
  })
  @IsOptional()
  @IsString()
  sectionLabel?: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  floorFrom: number;

  @ApiProperty({ example: 17 })
  @Type(() => Number)
  @IsInt()
  floorTo: number;

  @ApiProperty({ example: 4, description: 'Квартир на каждом этаже в этом блоке' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  unitsPerFloor: number;

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

  @ApiProperty({ required: false })
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

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  layoutVariantId?: number;
}

export class BulkGenerateApartmentsDto {
  @ApiProperty({ type: [BulkSectionDto], minItems: 1 })
  @ValidateNested({ each: true })
  @Type(() => BulkSectionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  sections: BulkSectionDto[];
}
