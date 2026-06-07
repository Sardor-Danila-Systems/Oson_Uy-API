import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class MediaService {
  private readonly supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
  private readonly bucket = process.env.SUPABASE_BUCKET || 'oson-uy';

  uploadImage(file: Express.Multer.File): Promise<string> {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new InternalServerErrorException(
        'Supabase storage env is not configured',
      );
    }

    return this.uploadToSupabase(file);
  }

  /** Upload an arbitrary document (e.g. a .docx contract template). */
  uploadDocument(
    file: Express.Multer.File,
    folder = 'templates',
  ): Promise<string> {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new InternalServerErrorException(
        'Supabase storage env is not configured',
      );
    }

    return this.uploadToSupabase(file, folder);
  }

  private async uploadToSupabase(
    file: Express.Multer.File,
    folder = 'uploads',
  ): Promise<string> {
    const extension = file.originalname.split('.').pop() || 'bin';
    const path = `${folder}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${extension}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to upload image: ${error.message}`,
      );
    }

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
