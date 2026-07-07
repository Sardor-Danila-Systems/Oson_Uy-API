import { PartialType } from '@nestjs/swagger';
import { CreateDeveloperDto } from './create-developer.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateDeveloperDto extends PartialType(CreateDeveloperDto) {
  @ApiProperty({
    description: 'QR code image URL for verified developer',
    example: 'https://example.com/qr-code.png',
    required: false,
  })
  @IsOptional()
  @IsString()
  qrCodeUrl?: string;

  @ApiProperty({ description: 'Login email', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  newPassword: string;
}
