import {
  BadRequestException,
  Body,
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

/** MIME types we accept for optimisation. */
const ALLOWED_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
];
/** Extensions we accept as a fallback when the browser sends a vague MIME. */
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif'];

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // originals may be large (up to ~50 MB)

@ApiTags('media')
@Controller('upload')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('image')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({
    summary:
      'Optimise an image (Sharp → WebP + thumbnail) and store it in Supabase',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: {
          type: 'string',
          enum: ['projects', 'developers', 'avatars', 'news'],
          example: 'projects',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Image optimised and uploaded',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        imageUrl: { type: 'string' },
        thumbnailUrl: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        mimeType: { type: 'string', example: 'image/webp' },
        optimizedSize: { type: 'number' },
        originalSize: { type: 'number' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadImage(
    @UploadedFile() file?: Express.Multer.File,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const mimeOk = ALLOWED_MIME.includes(file.mimetype.toLowerCase());
    const extOk = ALLOWED_EXT.includes(ext);
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Unsupported format. Allowed: JPG, JPEG, PNG, WEBP, HEIC, AVIF.',
      );
    }

    const result = await this.mediaService.optimizeAndUploadImage(file, folder);
    // `url` is kept for backward compatibility with existing callers.
    return { url: result.imageUrl, ...result };
  }
}
