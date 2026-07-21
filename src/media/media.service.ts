import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

/** Result of running a raw upload through the optimisation pipeline. */
export interface OptimizedImage {
  /** Public URL of the optimised full-size WebP. */
  imageUrl: string;
  /** Public URL of the 400px WebP thumbnail. */
  thumbnailUrl: string;
  /** Final width of the optimised image, in pixels. */
  width: number;
  /** Final height of the optimised image, in pixels. */
  height: number;
  /** Always `image/webp`. */
  mimeType: string;
  /** Byte size of the optimised full-size image. */
  optimizedSize: number;
  /** Byte size of the original upload (for reporting compression ratio). */
  originalSize: number;
}

/** Storage folders the pipeline is allowed to write into. */
const ALLOWED_FOLDERS = ['projects', 'developers', 'avatars', 'news'] as const;
type AllowedFolder = (typeof ALLOWED_FOLDERS)[number];

/** Never upscale beyond this width; larger images are shrunk to it. */
const MAX_WIDTH = 1920;
/** Thumbnail width. */
const THUMB_WIDTH = 400;

@Injectable()
export class MediaService {
  private readonly supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
  private readonly bucket = process.env.SUPABASE_BUCKET || 'oson-uy';

  private assertConfigured() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new InternalServerErrorException(
        'Supabase storage env is not configured',
      );
    }
  }

  /**
   * Full production image pipeline — everything happens in memory, no temp
   * files touch disk:
   *   1. decode + validate (corrupted files are rejected)
   *   2. auto-rotate per EXIF orientation
   *   3. strip all metadata (Sharp drops it unless explicitly kept)
   *   4. downscale to {@link MAX_WIDTH} (never upscale, keep aspect ratio)
   *   5. encode to WebP (quality 82, effort 6)
   *   6. render a {@link THUMB_WIDTH}px WebP thumbnail (quality 75)
   *   7. upload BOTH optimised assets under a UUID name; the original is
   *      never stored.
   */
  async optimizeAndUploadImage(
    file: Express.Multer.File,
    folder = 'projects',
  ): Promise<OptimizedImage> {
    this.assertConfigured();

    const targetFolder: AllowedFolder = ALLOWED_FOLDERS.includes(
      folder as AllowedFolder,
    )
      ? (folder as AllowedFolder)
      : 'projects';

    // 1–2. Validate + auto-rotate. `failOn: 'error'` rejects genuinely
    // corrupted data while tolerating benign encoder warnings.
    let sourceWidth: number;
    try {
      const meta = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .metadata();
      if (!meta.width || !meta.height) {
        throw new Error('missing dimensions');
      }
      sourceWidth = meta.width;
    } catch {
      throw new BadRequestException(
        'The image is corrupted or in an unsupported format.',
      );
    }

    // 4–5. Full-size WebP. Metadata is stripped by default (we never call
    // withMetadata/keepMetadata). Resize only when wider than the cap.
    const mainPipeline = sharp(file.buffer, { failOn: 'error' }).rotate();
    if (sourceWidth > MAX_WIDTH) {
      mainPipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }
    const mainBuffer = await mainPipeline
      .webp({ quality: 82, effort: 6, smartSubsample: true })
      .toBuffer();

    // Read back the real output dimensions.
    const finalMeta = await sharp(mainBuffer).metadata();

    // 6. Thumbnail.
    const thumbBuffer = await sharp(file.buffer, { failOn: 'error' })
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 75, effort: 6 })
      .toBuffer();

    // 7. Upload both under a shared UUID base name.
    const base = randomUUID();
    const [imageUrl, thumbnailUrl] = await Promise.all([
      this.uploadBuffer(`${targetFolder}/${base}.webp`, mainBuffer),
      this.uploadBuffer(`${targetFolder}/${base}-thumb.webp`, thumbBuffer),
    ]);

    return {
      imageUrl,
      thumbnailUrl,
      width: finalMeta.width ?? sourceWidth,
      height: finalMeta.height ?? 0,
      mimeType: 'image/webp',
      optimizedSize: mainBuffer.length,
      originalSize: file.size || file.buffer.length,
    };
  }

  /** Upload an arbitrary document (e.g. a .docx contract template). */
  uploadDocument(
    file: Express.Multer.File,
    folder = 'templates',
  ): Promise<string> {
    this.assertConfigured();
    return this.uploadRaw(file, folder);
  }

  /**
   * Store a file as-is (no optimisation). Used for formats the image pipeline
   * cannot/should not transcode — PDF floor plans, animated GIFs — so existing
   * uploaders (e.g. layout planning) keep working.
   */
  uploadOriginal(
    file: Express.Multer.File,
    folder = 'uploads',
  ): Promise<string> {
    this.assertConfigured();
    return this.uploadRaw(file, folder);
  }

  /** Store an already-prepared buffer and return its public URL. */
  private async uploadBuffer(
    path: string,
    buffer: Buffer,
    contentType = 'image/webp',
  ): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to upload image: ${error.message}`,
      );
    }

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /** Store an original file as-is (documents only — never for public images). */
  private async uploadRaw(
    file: Express.Multer.File,
    folder = 'uploads',
  ): Promise<string> {
    const extension = file.originalname.split('.').pop() || 'bin';
    const path = `${folder}/${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to upload file: ${error.message}`,
      );
    }

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
