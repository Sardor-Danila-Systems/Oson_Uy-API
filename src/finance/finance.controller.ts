import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { ProjectMemberGuard } from '../common/guards/project-member.guard';
import { ProjectUltimatePlanGuard } from '../common/guards/project-ultimate-plan.guard';
import {
  PermissionGuard,
  RequirePermission,
} from '../common/guards/permission.guard';
import { FinanceService } from './finance.service';

type DevRequest = Request & { developerId?: number };

@ApiTags('finance')
@ApiBearerAuth()
@Controller('projects/:projectId/finance')
@UseGuards(
  DeveloperAuthGuard,
  ProjectMemberGuard,
  ProjectUltimatePlanGuard,
  PermissionGuard,
)
@RequirePermission('finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  summary(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.summary(projectId, req.developerId!);
  }

  @Get('income')
  income(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.income(projectId, req.developerId!);
  }

  @Get('expenses')
  listExpenses(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.listExpenses(projectId, req.developerId!);
  }

  @Post('expenses')
  addExpense(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Body()
    dto: {
      title: string;
      category?: string;
      amountUzs: number;
      method?: string;
      spentAt?: string;
      comment?: string;
    },
  ) {
    return this.service.addExpense(projectId, req.developerId!, dto);
  }

  @Delete('expenses/:id')
  removeExpense(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: DevRequest,
  ) {
    return this.service.removeExpense(projectId, req.developerId!, id);
  }

  @Get('transfers')
  listTransfers(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.listTransfers(projectId, req.developerId!);
  }

  @Post('transfers')
  transfer(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
    @Body()
    dto: { fromMethod: string; toMethod: string; amountUzs: number; comment?: string },
  ) {
    return this.service.transfer(projectId, req.developerId!, dto);
  }

  @Get('debtors')
  debtors(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.debtors(projectId, req.developerId!);
  }

  @Get('audit')
  audit(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: DevRequest,
  ) {
    return this.service.audit(projectId, req.developerId!);
  }
}
