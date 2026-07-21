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

/** MIME types the Sharp pipeline optimises (→ WebP + thumbnail). */
const OPTIMIZABLE_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
];
/** Extensions accepted as a fallback when the browser sends a vague MIME. */
const OPTIMIZABLE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif'];

/**
 * Formats we accept but never transcode — stored as-is. PDFs (floor plans) and
 * animated GIFs must keep their original form, so existing uploaders that rely
 * on this endpoint (e.g. layout planning) keep working.
 */
const PASSTHROUGH_MIME = ['application/pdf', 'image/gif'];
const PASSTHROUGH_EXT = ['pdf', 'gif'];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // originals may be large (up to ~50 MB)

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
    const mime = file.mimetype.toLowerCase();

    // Optimisable images → Sharp pipeline (WebP + thumbnail + metadata).
    if (OPTIMIZABLE_MIME.includes(mime) || OPTIMIZABLE_EXT.includes(ext)) {
      const result = await this.mediaService.optimizeAndUploadImage(
        file,
        folder,
      );
      // `url` is kept for backward compatibility with existing callers.
      return { url: result.imageUrl, ...result };
    }

    // PDF / GIF → stored as-is so floor-plan and other document uploads work.
    if (PASSTHROUGH_MIME.includes(mime) || PASSTHROUGH_EXT.includes(ext)) {
      const url = await this.mediaService.uploadOriginal(file, folder);
      return { url, imageUrl: url };
    }

    throw new BadRequestException(
      'Unsupported format. Allowed: JPG, JPEG, PNG, WEBP, HEIC, AVIF, PDF.',
    );
  }
}
