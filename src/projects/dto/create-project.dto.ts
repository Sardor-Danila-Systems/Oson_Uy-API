import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  IsNumber,
  IsUrl,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** One optimised gallery image with its metadata (from the upload pipeline). */
export class MediaItemDto {
  @ApiProperty({ description: 'Optimised full-size WebP URL' })
  @IsString()
  imageUrl: string;

  @ApiProperty({ description: '400px WebP thumbnail URL', required: false })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: 'Image width in px', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  width?: number;

  @ApiProperty({ description: 'Image height in px', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  height?: number;

  @ApiProperty({ description: 'MIME type, e.g. image/webp', required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ description: 'Optimised byte size', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  optimizedSize?: number;
}

export class CreateProjectDto {
  @ApiProperty({
    description: 'The name of the real estate project',
    example: 'Sunset Gardens',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'The location/city of the project',
    example: 'Tashkent',
  })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty({
    description: 'District of project inside city/region',
    example: 'Siyob',
    required: false,
  })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiProperty({
    description: 'Short project description',
    example: 'Comfort-class project near city center with family facilities.',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Project advantages list',
    example: ['Close to center', 'Underground parking', 'Kindergarten nearby'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  advantages?: string[];

  @ApiProperty({
    description: 'Building materials (e.g. monolith, brick)',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  materials?: string[];

  @ApiProperty({ description: 'Installment available', required: false })
  @IsOptional()
  @IsBoolean()
  hasInstallment?: boolean;

  @ApiProperty({ description: 'Number of buildings', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  buildingCount?: number;

  @ApiProperty({ description: 'Number of blocks/corps', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  corpusCount?: number;

  @ApiProperty({ description: 'Ceiling height in meters', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ceilingHeightM?: number;

  @ApiProperty({ description: 'Surface parking available', required: false })
  @IsOptional()
  @IsBoolean()
  hasSurfaceParking?: boolean;

  @ApiProperty({ description: 'Underground parking available', required: false })
  @IsOptional()
  @IsBoolean()
  hasUndergroundParking?: boolean;

  @ApiProperty({ description: 'Surface parking spaces count', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  surfaceParkingSpaces?: number;

  @ApiProperty({
    description: 'Underground parking spaces count',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  undergroundParkingSpaces?: number;

  @ApiProperty({ description: 'Number of elevators', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  elevatorsCount?: number;

  @ApiProperty({
    description: 'Latitude for nearby sorting (optional)',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiProperty({
    description: 'Longitude for nearby sorting (optional)',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiProperty({
    description: 'Map embed URL (Google/2GIS/Yandex embed link)',
    example: 'https://www.google.com/maps/embed?...',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  mapEmbedUrl?: string;

  @ApiProperty({
    description: 'Project-specific QR code URL (optional)',
    example: 'https://example.com/project-qr.png',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  qrCodeUrl?: string;

  @ApiProperty({
    description: 'Total number of floors in the project',
    example: 16,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalFloors?: number;

  @ApiProperty({
    description: 'Total number of units in the project (optional)',
    example: 220,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalUnits?: number;

  @ApiProperty({
    description: 'The expected delivery date of the project',
    example: '2025-12-31',
  })
  @IsNotEmpty()
  @IsString()
  deliveryDate: string;

  @ApiProperty({
    description:
      'Main image URL for the project (optional, will use placeholder if not provided)',
    example: 'https://example.com/project-image.jpg',
    required: false,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({
    description: 'Video URL for the project (optional)',
    example: 'https://example.com/project-video.mp4',
    required: false,
  })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiProperty({
    description: 'Additional project gallery image URLs (optional)',
    example: [
      'https://example.com/project-1.jpg',
      'https://example.com/project-2.jpg',
    ],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @ApiProperty({
    description:
      'Optimised gallery images with metadata (preferred over imageUrls)',
    type: [MediaItemDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaItemDto)
  mediaItems?: MediaItemDto[];

  @ApiProperty({
    description: 'The ID of the developer owning this project',
    example: 1,
  })
  @IsNotEmpty()
  @IsInt()
  developerId: number;
}
