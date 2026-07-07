import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import {
  PermissionGuard,
  RequirePermission,
} from '../common/guards/permission.guard';
import { MembersService } from './members.service';

type DevRequest = Request & { developerId?: number };

@ApiTags('members')
@ApiBearerAuth()
@Controller('projects/:projectId/members')
@UseGuards(DeveloperAuthGuard, ProjectMemberGuard, PermissionGuard)
export class MembersController {
  constructor(private readonly service: MembersService) {}

  /** Роль и права текущего пользователя — доступно любому участнику. */
  @Get('me')
  me(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.me(projectId, req.developerId!);
  }

  @Get('catalog')
  catalog() {
    return this.service.catalog();
  }

  @Get()
  @RequirePermission('team')
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.list(projectId, req.developerId!);
  }

  @Post()
  @RequirePermission('team')
  invite(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: { name?: string; email: string; role: string; password?: string },
  ) {
    return this.service.invite(projectId, dto);
  }

  @Patch(':memberId/role')
  @RequirePermission('team')
  updateRole(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() dto: { role: string },
  ) {
    return this.service.updateRole(projectId, memberId, dto.role);
  }

  @Patch(':memberId/permissions')
  @RequirePermission('team')
  updatePermissions(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() dto: { permissions: Record<string, boolean> },
  ) {
    return this.service.updatePermissions(projectId, memberId, dto.permissions);
  }

  @Delete(':memberId')
  @RequirePermission('team')
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.remove(projectId, memberId, req.developerId!);
  }
}
