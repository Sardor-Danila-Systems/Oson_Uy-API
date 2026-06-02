import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import {
  DocLang,
  DocType,
  DocumentGenerationService,
} from './document-generation.service';

@UseGuards(DeveloperAuthGuard)
@Controller('projects/:projectId/contracts/:contractId/documents')
export class DocumentGenerationController {
  constructor(private readonly service: DocumentGenerationService) {}

  @Get('contract')
  async downloadContract(
    @Param('contractId', ParseIntPipe) contractId: number,
    @Query('lang') lang: DocLang = 'uz',
    @Res() res: Response,
  ) {
    const buffer = await this.service.generateContractDocx(contractId, lang);
    this.sendDocx(res, buffer, `contract_${contractId}.docx`);
  }

  @Get('guarantee-letter')
  async downloadGuaranteeLetter(
    @Param('contractId', ParseIntPipe) contractId: number,
    @Query('lang') lang: DocLang = 'uz',
    @Res() res: Response,
  ) {
    const buffer = await this.service.generateGuaranteeLetterDocx(contractId, lang);
    this.sendDocx(res, buffer, `guarantee_${contractId}.docx`);
  }

  @Get('payment-schedule')
  async downloadPaymentSchedule(
    @Param('contractId', ParseIntPipe) contractId: number,
    @Query('lang') lang: DocLang = 'uz',
    @Res() res: Response,
  ) {
    const buffer = await this.service.generatePaymentScheduleDocx(contractId, lang);
    this.sendDocx(res, buffer, `schedule_${contractId}.docx`);
  }

  private sendDocx(res: Response, buffer: Buffer, filename: string) {
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}
