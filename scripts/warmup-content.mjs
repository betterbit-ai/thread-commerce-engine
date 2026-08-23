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
console.log('skip=false');
console.log(`warmup_id=${post.warmup_id}`);
console.log(`warmup_text<<EOF\n${post.text}\nEOF`);
