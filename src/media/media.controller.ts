import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaService } from './media.service';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';

@ApiTags('media')
@Controller('upload')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('image')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Upload image to Supabase Storage and return URL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Image uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example:
            'https://YOUR_PROJECT.supabase.co/storage/v1/object/public/YOUR_BUCKET/uploads/example.jpg',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
    ];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only images and PDFs are allowed');
    }

    const url = await this.mediaService.uploadImage(file);
    return { url };
  }
}
