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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { FilterContractDto } from './dto/filter-contract.dto';
import { AddPaymentDto } from './dto/add-payment.dto';

type DevRequest = Request & { developerId?: number };

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('projects/:projectId/contracts')
@UseGuards(DeveloperAuthGuard, ProjectMemberGuard, ProjectUltimatePlanGuard)
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get()
  @ApiOperation({ summary: 'List contracts for project' })
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Query() query: FilterContractDto,
  ) {
    return this.service.list(projectId, req.developerId!, query);
  }

  @Get('stats')
  stats(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.getProjectStats(projectId, req.developerId!);
  }

  @Get('forecast')
  forecast(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Query('months') months?: string,
  ) {
    return this.service.getPaymentForecast(
      projectId,
      req.developerId!,
      months ? parseInt(months) : 6,
    );
  }

  @Get(':id')
  findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
  ) {
    return this.service.findOne(projectId, id, req.developerId!);
  }

  @Post()
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Body() dto: CreateContractDto,
  ) {
    return this.service.create(projectId, req.developerId!, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
    @Body() dto: UpdateContractDto,
  ) {
    return this.service.update(projectId, id, req.developerId!, dto);
  }

  @Delete(':id')
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
  ) {
    return this.service.remove(projectId, id, req.developerId!);
  }

  @Post(':id/payments')
  addPayment(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
    @Body() dto: AddPaymentDto,
  ) {
    return this.service.addPayment(projectId, id, req.developerId!, dto);
  }

  @Delete(':id/payments/:paymentId')
  removePayment(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.removePayment(projectId, id, paymentId, req.developerId!);
  }
}
