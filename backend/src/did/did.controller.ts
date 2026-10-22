import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { DidService } from './did.service';
import {
  GenerateDidDto,
  IssueCredentialDto,
  PresentCredentialDto,
  RevokeCredentialDto,
} from './dto/did.dto';
import { VerifiablePresentation } from './did.interface';

@Controller('did')
export class DidController {
  constructor(private readonly didService: DidService) {}

  @Post('generate')
  generateDid(@Body() dto: GenerateDidDto) {
    return this.didService.generateDid(dto);
  }

  @Post('credentials/issue')
  issueCredential(@Body() dto: IssueCredentialDto) {
    return this.didService.issueCredential(dto);
  }

  @Post('credentials/present')
  presentCredential(@Body() dto: PresentCredentialDto) {
    return this.didService.presentCredential(dto);
  }

  @Post('credentials/verify')
  verifyPresentation(@Body() presentation: VerifiablePresentation) {
    return this.didService.verifyPresentation(presentation);
  }

  @Post('credentials/revoke')
  revokeCredential(@Body() dto: RevokeCredentialDto) {
    return this.didService.revokeCredential(dto);
  }

  @Get('credentials/status/:id')
  getCredentialStatus(@Param('id') id: string) {
    return this.didService.getCredentialStatus(id);
  }
}
