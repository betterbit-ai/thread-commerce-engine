import { readFile } from 'node:fs/promises';

const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_CHANNEL_ID;
if (!token || !channel) throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required');

let text = process.env.SLACK_MESSAGE;
if (process.env.SLACK_SUMMARY_PATH) {
  const summary = JSON.parse(await readFile(process.env.SLACK_SUMMARY_PATH, 'utf8'));
  if (summary.kind === 'daily_funnel') {
    const stages = summary.stages;
    const value = (item) => (typeof item === 'number' ? item.toLocaleString('ko-KR') : '미연결');
    const percentage = (item) =>
      typeof item === 'number' ? `${(item * 100).toFixed(1)}%` : '미측정';
    text = [
      process.env.SLACK_TITLE ?? '📊 Techpick 일일 퍼널',
      `Threads 노출 ${value(stages.threads_root_views)} → 링크 댓글 도달 ${value(stages.link_reply_views)} → 랜딩 ${value(stages.landing_page_views)}`,
      `댓글 1 도달률 ${percentage(summary.rates.reply_1_reach)} · 링크 댓글 도달률 ${percentage(summary.rates.link_reach)}`,
      `쿠팡 클릭 ${value(stages.coupang_clicks)} → 주문 ${value(stages.coupang_orders)} → 수익 ${value(stages.commission_krw)}원`,
      summary.blockers.length ? `확인 필요: ${summary.blockers.join(', ')}` : '전체 퍼널 연결됨',
    ].join('\n');
  } else {
    const totals = summary.totals ?? {};
    const metrics = summary.metrics ?? {};
    const percentage = (value) =>
      typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '—';
    text = [
      process.env.SLACK_TITLE ?? 'Techpick 성과 수집 완료',
      `조회 ${totals.threads_views ?? 0} · 클릭 ${totals.coupang_clicks ?? 0} · 주문 ${totals.orders ?? 0}`,
      `반응률 ${percentage(metrics.engagement_rate)} · 답글률 ${percentage(metrics.reply_rate)} · CTR ${percentage(metrics.commerce_ctr)}`,
    ].join('\n');
  }
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
