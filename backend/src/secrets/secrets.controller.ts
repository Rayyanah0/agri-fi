import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SecretManagementService } from './secrets.service';

class SecretIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  secretId: string;
}

@ApiTags('secret management')
@ApiBearerAuth('jwt')
@Controller({ version: '1', path: 'admin/secrets' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class SecretManagementController {
  constructor(private readonly secrets: SecretManagementService) {}

  @Get()
  @ApiOperation({ summary: 'List managed secret metadata without values' })
  list(@Request() request: { user: { id: string; role: string } }) {
    return this.secrets.listManagedSecrets({
      id: request.user.id,
      role: request.user.role,
    });
  }

  @Post('rotate')
  @ApiOperation({ summary: 'Start an immediate configured secret rotation' })
  rotate(
    @Body() body: SecretIdDto,
    @Request() request: { user: { id: string; role: string } },
  ) {
    return this.secrets.rotateSecret(body.secretId, {
      id: request.user.id,
      role: request.user.role,
    });
  }

  @Post('recover')
  @ApiOperation({
    summary: 'Promote the previous secret version to the current version',
  })
  recover(
    @Body() body: SecretIdDto,
    @Request() request: { user: { id: string; role: string } },
  ) {
    return this.secrets.recoverPreviousVersion(body.secretId, {
      id: request.user.id,
      role: request.user.role,
    });
  }
}
