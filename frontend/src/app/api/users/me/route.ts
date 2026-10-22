import { withBackendProxy } from '@/lib/api-proxy';

export const GET = withBackendProxy(async () => ({
  path: '/users/me',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
}));

/**
 * Updates the authenticated user's profile preferences.
 *
 * Used by the theme system (#1170) to synchronise appearance preferences
 * across devices, and by the settings page to persist the display currency.
 */
export const PATCH = withBackendProxy(async (request) => {
  const body = await request.text();

  return {
    path: '/users/me',
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  };
});
