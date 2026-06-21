import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  Req,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { FilterProjectDto } from './dto/filter-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectProgressDto } from './dto/update-project-progress.dto';
import { UpdateBuildingProgressDto } from './dto/update-building-progress.dto';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { Request } from 'express';
import { ApartmentsService } from '../apartments/apartments.service';
import { FilterApartmentDto } from '../apartments/dto/filter-apartment.dto';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly apartmentsService: ApartmentsService,
  ) {}

  @Post()
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() request: Request & { developerId?: number },
  ) {
    if (!request.developerId) {
      throw new BadRequestException('Developer identity is required');
    }
    return this.projectsService.create({
      ...createProjectDto,
      developerId: request.developerId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all projects with optional filtering' })
  @ApiQuery({
    name: 'location',
    required: false,
    description: 'Project location/city',
    type: String,
  })
  @ApiQuery({
    name: 'pricePerM2Min',
    required: false,
    description: 'Minimum price per m² in project (UZS)',
    type: Number,
  })
  @ApiQuery({
    name: 'pricePerM2Max',
    required: false,
    description: 'Maximum price per m² in project (UZS)',
    type: Number,
  })
  @ApiQuery({
    name: 'hasInstallment',
    required: false,
    description: 'Filter projects with (true) or without (false) installment',
    type: Boolean,
  })
  @ApiResponse({
    status: 200,
    description: 'List of projects with developer and floor pricing',
  })
  findAll(@Query() filters: FilterProjectDto) {
    return this.projectsService.findAll(filters);
  }

  @Get('mine')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: "Projects owned by the authenticated developer" })
  @ApiResponse({ status: 200, description: "Developer's own projects" })
  findMine(
    @Query() filters: FilterProjectDto,
    @Req() request: Request & { developerId?: number },
  ) {
    if (!request.developerId) {
      throw new BadRequestException('Developer identity is required');
    }
    return this.projectsService.findMine(request.developerId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Project details with developer and floors',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findOne(id);
  }

  @Get(':id/full')
  @ApiOperation({ summary: 'Get full project details with floors and media' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Project full details with floors, layouts, and area options',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findFull(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findFullById(id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Get project progress milestones and percent' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  getProgress(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProgress(id);
  }

  @Get(':id/apartments')
  @ApiOperation({ summary: 'Public apartment list (chessboard / catalog)' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  listApartmentsPublic(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: FilterApartmentDto,
  ) {
    return this.apartmentsService.listPublic(id, query);
  }

  @Patch(':id/building-progress')
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  @ApiOperation({
    summary: 'Update construction stages checklist and overall percent',
  })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  updateBuildingProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBuildingProgressDto,
  ) {
    return this.projectsService.updateBuildingProgress(id, dto);
  }

  @Patch(':id')
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  @ApiOperation({ summary: 'Update project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, updateProjectDto);
  }

  @Patch(':id/progress')
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  @ApiOperation({ summary: 'Replace project progress milestones (developer only)' })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  replaceProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectProgressDto,
  ) {
    return this.projectsService.replaceProgress(id, dto.milestones);
  }

  @Delete(':id/reviews')
  @UseGuards(DeveloperAuthGuard, ProjectMemberGuard)
  @ApiOperation({
    summary:
      'Deprecated admin review endpoint (reviews are collected from user feedback only)',
  })
  @ApiParam({ name: 'id', description: 'Project ID', type: Number })
  disableAdminReviewCreation() {
    throw new BadRequestException(
      'Project reviews are collected from users via feedback flow only',
    );
  }
}
