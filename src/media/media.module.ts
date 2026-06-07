import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { AuthModule } from '../auth/auth.module';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService, DeveloperAuthGuard],
  exports: [MediaService],
})
export class MediaModule {}
