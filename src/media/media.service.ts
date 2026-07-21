import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
// `import sharp = require(...)` (not a default import): sharp is a CommonJS
// module whose export IS the callable. Under the Nest webpack builder a default
// import compiles to `sharp_1.default`, which is undefined for the externalised
// CJS require → "(0, sharp_1.default) is not a function". This form binds the
// callable directly while keeping the `sharp.Metadata` type namespace.
import sharp = require('sharp');

// Memory safety for constrained hosts (e.g. Render 512 MB): disable the libvips
// operation cache (keeps decoded rasters resident) and pin libvips to a single
// thread per operation. Off-heap native memory — not the V8 heap — is what OOMs
// here, so these matter more than --max-old-space-size.
sharp.cache(false);
sharp.concurrency(1);

/**
 * Max Sharp jobs allowed to run at once, process-wide, to bound peak memory.
 * Kept at 1 for the 512 MB tier — a single 48 MP decode + WebP encode is the
 * memory ceiling; running two at once risks OOM. Raise if the host has more RAM.
 */
const MAX_CONCURRENT_JOBS = 1;
/** Reject absurdly large rasters (decompression bombs) up front. */
const MAX_INPUT_PIXELS = 100_000_000; // 100 MP

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
  private readonly logger = new Logger(MediaService.name);

  // Simple in-process semaphore so concurrent uploads don't run unbounded Sharp
  // jobs in parallel and blow the memory limit.
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT_JOBS) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiters.shift()?.();
    }
  }

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

    // Decode → optimise inside a concurrency slot. Any Sharp failure here
    // (corrupted data, or a format this platform's libvips can't decode)
    // surfaces its real reason instead of a generic message.
    let mainBuffer: Buffer;
    let thumbBuffer: Buffer;
    let finalMeta: sharp.Metadata;
    try {
      ({ mainBuffer, thumbBuffer, finalMeta } = await this.withSlot(
        async () => {
          // Decode the original ONCE. `sequentialRead` lowers peak memory for
          // large JPEGs, and downscaling in this same pipeline lets libvips use
          // JPEG shrink-on-load (it never materialises the full-res raster).
          const main = await sharp(file.buffer, {
            failOn: 'error',
            sequentialRead: true,
            limitInputPixels: MAX_INPUT_PIXELS,
          })
            .rotate()
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .webp({ quality: 82, effort: 4, smartSubsample: true })
            .toBuffer({ resolveWithObject: true });

          if (!main.info.width || !main.info.height) {
            throw new Error('image has no readable dimensions');
          }

          // Thumbnail is derived from the already-small main buffer — no second
          // decode of the (potentially huge) original.
          const thumb = await sharp(main.data)
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: 75, effort: 4 })
            .toBuffer();

          return {
            mainBuffer: main.data,
            thumbBuffer: thumb,
            finalMeta: {
              width: main.info.width,
              height: main.info.height,
            } as sharp.Metadata,
          };
        },
      ));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Image processing failed [name=${file.originalname} mime=${file.mimetype} size=${file.size}B]: ${reason}`,
      );
      throw new BadRequestException(`Image could not be processed: ${reason}`);
    }

    // Upload both under a shared UUID base name.
    const base = randomUUID();
    const [imageUrl, thumbnailUrl] = await Promise.all([
      this.uploadBuffer(`${targetFolder}/${base}.webp`, mainBuffer),
      this.uploadBuffer(`${targetFolder}/${base}-thumb.webp`, thumbBuffer),
    ]);

    return {
      imageUrl,
      thumbnailUrl,
      width: finalMeta.width ?? 0,
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
