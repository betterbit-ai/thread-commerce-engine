import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collectGoogleAnalytics } from '../../src/infrastructure/google-analytics.js';

describe('Google Analytics collector', () => {
  it('exchanges a service-account assertion and reads funnel events', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('oauth2'))
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({
          rows: [
            { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '31' }] },
            {
              dimensionValues: [{ value: 'affiliate_click' }],
              metricValues: [{ value: '7' }],
            },
          ],
        }),
        { status: 200 },
      );
    };
    const result = await collectGoogleAnalytics({
      propertyId: '12345',
      credentialsJson: JSON.stringify({
        client_email: 'analytics@example.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        token_uri: 'https://oauth2.googleapis.com/token',
      }),
      fetchFn,
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    });
    expect(result).toEqual({ pageViews: 31, affiliateClicks: 7 });
    expect(calls[1]).toContain('/properties/12345:runReport');
  });
});
