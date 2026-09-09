import { createSign } from 'node:crypto';
import { z } from 'zod';
import { ExternalApiError } from '../shared/errors.js';

const credentialsSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z.string().url().default('https://oauth2.googleapis.com/token'),
});
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() });
const reportSchema = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })),
        metricValues: z.array(z.object({ value: z.string() })),
      }),
    )
    .optional(),
});

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export async function collectGoogleAnalytics(options: {
  propertyId: string;
  credentialsJson: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): Promise<{ pageViews: number; affiliateClicks: number }> {
  const credentials = credentialsSchema.parse(JSON.parse(options.credentialsJson));
  const now = options.now ?? (() => new Date());
  const fetchFn = options.fetchFn ?? fetch;
  const issuedAt = Math.floor(now().getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: credentials.token_uri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, 'base64url')}`;
  const tokenResponse = await fetchFn(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok)
    throw new ExternalApiError('Google OAuth token request failed', tokenResponse.status, false);
  const token = tokenSchema.parse(tokenBody);
  const reportResponse = await fetchFn(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(options.propertyId)}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: { values: ['page_view', 'affiliate_click'] },
          },
        },
      }),
    },
  );
  const reportBody = await reportResponse.json();
  if (!reportResponse.ok)
    throw new ExternalApiError(
      'Google Analytics report request failed',
      reportResponse.status,
      false,
    );
  const report = reportSchema.parse(reportBody);
  const metrics = new Map(
    (report.rows ?? []).map((row) => [
      row.dimensionValues[0]?.value,
      Number(row.metricValues[0]?.value ?? 0),
    ]),
  );
  return {
    pageViews: metrics.get('page_view') ?? 0,
    affiliateClicks: metrics.get('affiliate_click') ?? 0,
  };
}
