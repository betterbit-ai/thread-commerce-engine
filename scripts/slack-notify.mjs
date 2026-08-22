import { readFile } from 'node:fs/promises';

const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_CHANNEL_ID;
if (!token || !channel) throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required');

let text = process.env.SLACK_MESSAGE;
if (process.env.SLACK_SUMMARY_PATH) {
  const summary = JSON.parse(await readFile(process.env.SLACK_SUMMARY_PATH, 'utf8'));
  const totals = summary.totals ?? {};
  const metrics = summary.metrics ?? {};
  const percentage = (value) => (typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '—');
  text = [
    process.env.SLACK_TITLE ?? 'Techpick 성과 수집 완료',
    `조회 ${totals.threads_views ?? 0} · 클릭 ${totals.coupang_clicks ?? 0} · 주문 ${totals.orders ?? 0}`,
    `반응률 ${percentage(metrics.engagement_rate)} · 답글률 ${percentage(metrics.reply_rate)} · CTR ${percentage(metrics.commerce_ctr)}`,
  ].join('\n');
}
if (process.env.SLACK_POLICY_REPORT) {
  const report = JSON.parse(await readFile(process.env.SLACK_POLICY_REPORT, 'utf8'));
  const blocked = (report.drafts ?? []).filter((draft) => draft.hard_fails?.length);
  if (!blocked.length) process.exit(0);
  text = [
    `⚠️ Techpick 정책 검사에서 ${blocked.length}개 초안을 차단했습니다.`,
    ...blocked.map(
      (draft) => `- ${draft.product}: ${draft.hard_fails.map((item) => item.code).join(', ')}`,
    ),
  ].join('\n');
}
if (!text) throw new Error('SLACK_MESSAGE or SLACK_SUMMARY_PATH is required');

const response = await globalThis.fetch('https://slack.com/api/chat.postMessage', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
});
const result = await response.json();
if (!response.ok || !result.ok)
  throw new Error(`Slack notification failed: ${result.error ?? response.status}`);
console.log(`Slack notification sent to ${channel}`);
