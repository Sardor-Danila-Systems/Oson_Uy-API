import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { Scenes3DService } from './scenes-3d.service';

type DevRequest = Request & { developerId?: number };

@ApiTags('scenes-3d')
@Controller('projects/:projectId/scene')
export class Scenes3DController {
  constructor(private readonly service: Scenes3DService) {}

  /** Public — consumed by the WebGL viewer */
  @Get()
  getScene(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.service.getPublicScene(projectId);
  }

  // ── Dashboard (authenticated) ───────────────────────────────────────────────

  @Get('assets')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  listAssets(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.listAssets(projectId, req.developerId!);
  }

  @Post('assets')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 400 * 1024 * 1024 }, // 400 MB
    }),
  )
  uploadAsset(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { kind?: string; buildingKey?: string; format?: string },
  ) {
    return this.service.uploadAsset(projectId, req.developerId!, file, body);
  }

  @Post('assets/:assetId/process')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  processAsset(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('assetId', ParseIntPipe) assetId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.processAsset(projectId, assetId, req.developerId!);
  }

  @Delete('assets/:assetId')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  deleteAsset(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('assetId', ParseIntPipe) assetId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.deleteAsset(projectId, req.developerId!, assetId);
  }

  @Get('mapping')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  getMapping(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.getMappingState(projectId, req.developerId!);
  }

  @Post('map')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  map(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Body() body: { apartmentId: number; meshNode: string | null },
  ) {
    return this.service.mapApartment(
      projectId,
      req.developerId!,
      body.apartmentId,
      body.meshNode,
    );
  }

  @Post('auto-map')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  autoMap(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.autoMap(projectId, req.developerId!);
  }

  @Post('publish')
  @ApiBearerAuth()
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  publish(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Body()
    body: { assetId: number; spawn?: { position?: number[]; target?: number[] } },
  ) {
    return this.service.publish(
      projectId,
      req.developerId!,
      body.assetId,
      body.spawn,
    );
  }
}
