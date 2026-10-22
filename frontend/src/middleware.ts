import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { applySecurityHeaders } from './middleware/security-headers.middleware';

const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'es', 'fr', 'pt', 'sw'],

  // Used when no locale matches
  defaultLocale: 'en',
});

/**
 * Header used to propagate the latest locally computed behavioral risk level
 * to the server so adaptive authentication can react. Only the coarse risk
 * level is forwarded — never raw behavioral data.
 */
const BEHAVIORAL_RISK_HEADER = 'x-behavioral-risk';

/**
 * Cookie used to persist the latest locally computed behavioral risk level
 * so it survives client-side navigation and is available to server-side
 * adaptive authentication.
 */
const BEHAVIORAL_RISK_COOKIE = 'behavioral_risk';

const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const;
type RiskLevel = (typeof VALID_RISK_LEVELS)[number];

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && (VALID_RISK_LEVELS as readonly string[]).includes(value);
}

/**
 * Extract the auth token from the request (Authorization header or cookie).
 */
function getAuthToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.trim().length > 0) {
    return authHeader;
  }

  const tokenCookie =
    request.cookies.get('auth_token')?.value ??
    request.cookies.get('token')?.value ??
    request.cookies.get('access_token')?.value;

  return tokenCookie && tokenCookie.trim().length > 0 ? tokenCookie : null;
}

/**
 * Read the latest locally computed behavioral risk level from the request.
 * The client computes this locally (no cloud storage) and forwards only the
 * coarse risk level. Falls back to "low" when no signal is present.
 */
function getBehavioralRisk(request: NextRequest): RiskLevel {
  const headerRisk = request.headers.get(BEHAVIORAL_RISK_HEADER);
  if (isRiskLevel(headerRisk)) {
    return headerRisk;
  }

  const cookieRisk = request.cookies.get(BEHAVIORAL_RISK_COOKIE)?.value;
  if (isRiskLevel(cookieRisk)) {
    return cookieRisk;
  }

  return 'low';
}

export default function middleware(request: NextRequest): NextResponse {
  const response = intlMiddleware(request);

  // Continuous authentication: when an authenticated request is present,
  // propagate the latest locally computed behavioral risk level so that
  // server-side adaptive authentication can react. Only the coarse risk
  // level is forwarded — raw behavioral data never leaves the device.
  const authToken = getAuthToken(request);
  if (authToken) {
    const riskLevel = getBehavioralRisk(request);

    // Attach the risk level to the request headers for downstream handlers.
    request.headers.set(BEHAVIORAL_RISK_HEADER, riskLevel);

    // Reflect the risk level on the response so the client can keep it in
    // sync and server-side adaptive auth can read it on subsequent requests.
    response.headers.set(BEHAVIORAL_RISK_HEADER, riskLevel);

    response.cookies.set({
      name: BEHAVIORAL_RISK_COOKIE,
      value: riskLevel,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      // Short-lived: the client refreshes this as behavior is re-evaluated.
      maxAge: 60 * 5,
    });
  }

  return applySecurityHeaders(request, response);
}

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(en|es|fr|pt|sw)/:path*', '/((?!api|_next|_static|_vercel|[\\w-]+\\.\\w+).*)']
};