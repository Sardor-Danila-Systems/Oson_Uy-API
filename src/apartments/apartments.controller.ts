import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';
import { ApartmentsService } from './apartments.service';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';
import { FilterApartmentDto } from './dto/filter-apartment.dto';
import { BulkGenerateApartmentsDto } from './dto/bulk-generate-apartments.dto';
import {
  BulkUpdateApartmentsDto,
  DeleteSectionDto,
} from './dto/bulk-update-apartments.dto';

@ApiTags('apartments')
@ApiBearerAuth()
@Controller('projects/:projectId/apartments')
@UseGuards(DeveloperAuthGuard, ProjectMemberGuard, ProjectUltimatePlanGuard)
export class ApartmentsController {
  constructor(private readonly apartmentsService: ApartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List apartments for project (developer)' })
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: FilterApartmentDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.list(projectId, query);
  }

  @Get(':apartmentId')
  @ApiOperation({
    summary: 'Apartment detail with linked customers and recent leads',
  })
  findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('apartmentId', ParseIntPipe) apartmentId: number,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.findOneForDeveloper(
      projectId,
      apartmentId,
      request.developerId!,
    );
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Массовое создание квартир по блокам и этажам',
  })
  @ApiResponse({ status: 201 })
  bulk(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: BulkGenerateApartmentsDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.bulkGenerate(
      projectId,
      dto,
      request.developerId!,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create apartment' })
  @ApiResponse({ status: 201 })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateApartmentDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.create(projectId, dto, request.developerId!);
  }

  @Patch('bulk-update')
  @ApiOperation({ summary: 'Batch-edit apartments by block/floor' })
  bulkUpdate(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: BulkUpdateApartmentsDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.bulkUpdate(projectId, dto, request.developerId!);
  }

  @Post('delete-section')
  @ApiOperation({ summary: 'Delete a whole block (section)' })
  deleteSection(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: DeleteSectionDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.deleteSection(
      projectId,
      dto.sectionKey,
      request.developerId!,
    );
  }

  @Patch(':apartmentId')
  @ApiOperation({ summary: 'Update apartment' })
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('apartmentId', ParseIntPipe) apartmentId: number,
    @Body() dto: UpdateApartmentDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.update(
      projectId,
      apartmentId,
      dto,
      request.developerId!,
    );
  }

  @Delete(':apartmentId')
  @ApiOperation({ summary: 'Delete apartment' })
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('apartmentId', ParseIntPipe) apartmentId: number,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.apartmentsService.remove(
      projectId,
      apartmentId,
      request.developerId!,
    );
  }
}
