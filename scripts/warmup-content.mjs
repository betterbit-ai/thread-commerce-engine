import { readFile } from 'node:fs/promises';

const slot = process.env.WARMUP_SLOT;
const day =
  process.env.WARMUP_DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
if (!['morning', 'evening'].includes(slot))
  throw new Error('WARMUP_SLOT must be morning or evening');
const schedule = JSON.parse(
  await readFile(
    process.env.WARMUP_SCHEDULE_PATH ?? 'data/content/warmup-week-2026-08-24.json',
    'utf8',
  ),
);
const post = schedule.posts.find((item) => item.date_kst === day && item.slot === slot);
if (!post) {
  console.log('skip=true');
  process.exit(0);
}
if (post.kind === 'affiliate') {
  const disclosure =
    '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
  if (!post.text.includes(disclosure) || !post.text.includes('https://link.coupang.com/'))
    throw new Error('Affiliate scheduled posts require a disclosed Coupang Partners link');
}
console.log('skip=false');
console.log(`warmup_id=${post.warmup_id}`);
console.log(`warmup_text<<EOF\n${post.text}\nEOF`);
