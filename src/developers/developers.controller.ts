import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DevelopersService } from './developers.service';
import { CreateDeveloperDto } from './dto/create-developer.dto';
import {
  ChangePasswordDto,
  UpdateDeveloperDto,
} from './dto/update-developer.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { DeveloperAuthGuard } from '../common/guards/developer-auth.guard';
import { Request } from 'express';

@ApiTags('developers')
@Controller('developers')
export class DevelopersController {
  constructor(private readonly developersService: DevelopersService) {}

  @Post()
  @UseGuards(AdminApiKeyGuard)
  @ApiOperation({ summary: 'Create a new developer' })
  @ApiResponse({ status: 201, description: 'Developer created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  create(@Body() createDeveloperDto: CreateDeveloperDto) {
    return this.developersService.create(createDeveloperDto);
  }

  @Get()
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Get all developers' })
  @ApiResponse({
    status: 200,
    description: 'List of all developers with their projects',
  })
  findAll(@Req() request: Request & { developerId?: number }) {
    return this.developersService.findById(request.developerId ?? 0);
  }

  @Get('me/telegram-link')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Deep link to link Telegram (start param)' })
  @ApiResponse({ status: 200, description: 'deepLink and expiresAt' })
  createTelegramInvite(@Req() request: Request & { developerId?: number }) {
    const id = request.developerId ?? 0;
    return this.developersService.createTelegramLink(id);
  }

  @Post('me/push-tokens')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Register Expo push token for current developer' })
  @ApiResponse({ status: 201, description: 'Token registered' })
  registerPushToken(
    @Body() dto: RegisterPushTokenDto,
    @Req() request: Request & { developerId?: number },
  ) {
    const id = request.developerId ?? 0;
    return this.developersService.registerPushToken(id, dto);
  }

  @Post('me/change-password')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Change own password' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: Request & { developerId?: number },
  ) {
    return this.developersService.changePassword(
      request.developerId ?? 0,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Patch(':id')
  @UseGuards(DeveloperAuthGuard)
  @ApiOperation({ summary: 'Update developer by ID (including QR code)' })
  @ApiResponse({ status: 200, description: 'Developer updated successfully' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDeveloperDto: UpdateDeveloperDto,
    @Req() request: Request & { developerId?: number },
  ) {
    if (request.developerId !== id) {
      throw new ForbiddenException('No access to this developer profile');
    }
    return this.developersService.update(id, updateDeveloperDto);
  }
}
