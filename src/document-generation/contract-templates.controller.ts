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
import { ContractTemplatesService } from './contract-templates.service';
import { DocumentGenerationService } from './document-generation.service';

type DevRequest = Request & { developerId?: number };

@ApiTags('contract-templates')
@ApiBearerAuth()
@Controller('projects/:projectId/contract-templates')
@UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
export class ContractTemplatesController {
  constructor(
    private readonly service: ContractTemplatesService,
    private readonly docGen: DocumentGenerationService,
  ) {}

  /** Available placeholders for building a template */
  @Get('variables')
  variables() {
    return this.docGen.getAvailableVariables();
  }

  @Get()
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.list(projectId, req.developerId!);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      name?: string;
      type?: string;
      language?: string;
      isDefault?: string | boolean;
    },
  ) {
    return this.service.create(projectId, req.developerId!, file, body);
  }

  @Delete(':id')
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
  ) {
    return this.service.remove(projectId, req.developerId!, id);
  }
}
