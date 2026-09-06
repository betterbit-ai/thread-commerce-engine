import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

const slot = process.env.WARMUP_SLOT;
const day =
  process.env.WARMUP_DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
if (!['morning', 'evening'].includes(slot))
  throw new Error('WARMUP_SLOT must be morning or evening');
const schedule = JSON.parse(
  await readFile(process.env.WARMUP_SCHEDULE_PATH ?? 'data/content/scheduled-threads.json', 'utf8'),
);
const post = schedule.posts.find((item) => item.date_kst === day && item.slot === slot);
if (!post) {
  console.log('skip=true');
  process.exit(0);
}
const disclosure =
  '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
if (!post.root_text || post.root_text.includes('http'))
  throw new Error('Root post must be one text-only hook');
if (!Array.isArray(post.replies) || post.replies.length !== 3)
  throw new Error('Scheduled equipment threads require exactly three replies');
if (!post.replies[2].startsWith(disclosure) || !post.replies[2].includes('https://url.kr/sn9v9m'))
  throw new Error('Final reply must begin with disclosure and include the approved short URL');
const payload = Buffer.from(
  JSON.stringify({ root_text: post.root_text, replies: post.replies }),
).toString('base64');
console.log('skip=false');
console.log(`warmup_id=${post.warmup_id}`);
console.log(`warmup_payload_b64=${payload}`);
