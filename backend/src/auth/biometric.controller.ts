import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BiometricService } from './biometric.service';
import { BiometricEnrollDto, BiometricVerifyDto } from './dto/biometric.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('auth/biometric')
export class BiometricController {
  constructor(private readonly biometricService: BiometricService) {}

  @UseGuards(JwtAuthGuard)
  @Post('challenge')
  public getChallenge(@Request() req: any) {
    const userId = req.user?.id || req.user?.sub;
    return this.biometricService.generateChallenge(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('enroll')
  public async enroll(@Request() req: any, @Body() dto: BiometricEnrollDto) {
    const userId = req.user?.id || req.user?.sub;
    return this.biometricService.enrollCredential(userId, dto);
  }

  @Post('verify')
  public async verify(@Body('userId') userId: string, @Body() dto: BiometricVerifyDto) {
    return this.biometricService.verifyAssertion(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('credentials')
  public async listCredentials(@Request() req: any) {
    const userId = req.user?.id || req.user?.sub;
    return this.biometricService.listCredentials(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('credentials/:credentialId')
  public async revokeCredential(
    @Request() req: any,
    @Param('credentialId') credentialId: string,
  ) {
    const userId = req.user?.id || req.user?.sub;
    return {
      revoked: await this.biometricService.revokeCredential(userId, credentialId),
    };
  }

  @Get('analytics')
  public async getAnalytics() {
    return this.biometricService.getAnalytics();
  }
}
