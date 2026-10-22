import {
  Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, ParseIntPipe, ParseUUIDPipe,
  Post, Put, Query, Request, Res, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { timingSafeEqual } from 'crypto';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailIntegrationService } from './email-integration.service';
import { EmailTemplatesService } from './email-templates.service';
import { EmailPreference } from './entities/email.entities';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

interface AuthRequest { user: { id: string; role: string } }

@Controller({ path: 'email', version: '1' })
export class EmailIntegrationController {
  constructor(
    private readonly email: EmailIntegrationService,
    private readonly templates: EmailTemplatesService,
  ) {}

  // ----- Preferences -----
  @Get('preferences')
  @UseGuards(AuthGuard('jwt'))
  getPrefs(@Request() req: AuthRequest) {
    return this.email.getPreferences(req.user.id);
  }

  @Put('preferences')
  @UseGuards(AuthGuard('jwt'))
  updatePrefs(@Request() req: AuthRequest, @Body() dto: Partial<EmailPreference>) {
    return this.email.updatePreferences(req.user.id, dto);
  }

  // ----- Document sharing -----
  @Post('share/document/:documentId')
  @UseGuards(AuthGuard('jwt'))
  share(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: { recipients: string[]; message?: string; expiresInHours?: number },
    @Request() req: AuthRequest,
  ) {
    return this.email.shareDocument(documentId, req.user, body.recipients, body.message, Math.min(body.expiresInHours ?? 72, 168));
  }

  @Get('shared/:documentId')
  async shared(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('e', ParseIntPipe) e: number,
    @Query('s') s: string,
    @Res() res: any,
  ) {
    res.redirect(302, await this.email.resolveSharedDocument(documentId, e, s));
  }

  // ----- Tracking -----
  @Get('track/open/:id.gif')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async open(@Param('id') id: string, @Res() res: any) {
    await this.email.trackOpen(id);
    res.end(PIXEL);
  }

  @Get('track/click/:id')
  async click(@Param('id') id: string, @Query('u') u: string, @Query('s') s: string, @Res() res: any) {
    res.redirect(302, await this.email.trackClick(id, u, s));
  }

  // ----- One-click unsubscribe (GET from link, POST per RFC 8058) -----
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html')
  async unsubscribeGet(@Query('t') t: string) {
    const r = await this.email.unsubscribe(t);
    return `<!doctype html><html><body style="font-family:Inter,Arial;text-align:center;padding:64px">
<h1>You're unsubscribed</h1><p>You will no longer receive ${r.category === 'all' ? 'non-essential' : r.category} emails from Agri-Fi.</p>
<p><a href="${process.env.FRONTEND_URL ?? ''}/settings/notifications">Manage preferences</a></p></body></html>`;
  }

  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribePost(@Query('t') t: string) {
    return this.email.unsubscribe(t);
  }

  // ----- Email-to-platform (SendGrid Inbound Parse / SES→SNS webhook) -----
  @Post('inbound')
  @HttpCode(200)
  inbound(@Query('key') key: string, @Body() body: any) {
    const expected = Buffer.from(process.env.EMAIL_INBOUND_SECRET ?? '');
    const given = Buffer.from(key ?? '');
    if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new ForbiddenException('Invalid inbound key');
    }
    return this.email.processInbound(body);
  }
}

@Controller({ path: 'admin/email', version: '1' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class EmailAdminController {
  constructor(
    private readonly email: EmailIntegrationService,
    private readonly templates: EmailTemplatesService,
  ) {}

  @Get('analytics')
  analytics(@Query('days') days?: string) {
    return this.email.analytics(Number(days ?? 30));
  }

  @Get('security')
  security(@Query('domain') domain?: string) {
    return this.email.checkDomainSecurity(domain);
  }

  @Get('templates')
  list() {
    return this.templates.list();
  }

  @Post('templates/:name/preview')
  preview(@Param('name') name: string, @Body() vars: Record<string, any>) {
    return this.templates.render(name, vars ?? {});
  }

  @Post('schedule')
  schedule(@Body() body: { userId: string; title: string; message: string; sendAt?: string; linkUrl?: string }) {
    return this.email.queue({
      userId: body.userId, template: 'notification', category: 'marketing',
      sendAt: body.sendAt ? new Date(body.sendAt) : undefined,
      vars: { title: body.title, message: body.message, linkUrl: body.linkUrl ?? process.env.FRONTEND_URL },
    });
  }
}
