import { execFileSync } from 'node:child_process';
const value = process.env.EXPIRES_AT;
if (!value) {
  console.log(
    '::warning::THREADS_TOKEN_EXPIRES_AT is not configured; token health cannot be calculated.',
  );
  process.exit(0);
}
const days = (new Date(value).getTime() - Date.now()) / 86400000;
if (days > 10) {
  console.log(`Threads token health: ${Math.floor(days)} days remaining.`);
  process.exit(0);
}
console.log(`::warning::Threads token expires in ${Math.floor(days)} days; renew it securely.`);
if (process.env.GITHUB_REPOSITORY && process.env.GH_TOKEN) {
  const title = 'Renew Threads API access token';
  try {
    execFileSync(
      'gh',
      [
        'issue',
        'create',
        '--repo',
        process.env.GITHUB_REPOSITORY,
        '--title',
        title,
        '--body',
        `The configured Threads token expires at ${value}. Follow docs/OPERATIONS.md; never paste the token into this issue.`,
      ],
      { stdio: 'inherit' },
    );
  } catch {
    console.log('::warning::Could not create renewal issue (it may already exist).');
  }
}
