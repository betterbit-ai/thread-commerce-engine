const slot = process.env.WARMUP_SLOT;
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const messages = {
  morning:
    '오늘 할 일이 많아도, 가장 먼저 끝낼 한 가지만 정해두면 시작이 조금 쉬워지더라고요.\n\n오늘의 첫 번째 일은 무엇인가요?',
  evening:
    '오늘 할 일을 다 끝내지 못했어도, 하루를 버틴 것만으로 충분한 날이 있습니다.\n\n오늘도 수고 많았어요.',
};
if (!messages[slot]) throw new Error('WARMUP_SLOT must be morning or evening');
console.log(`warmup_id=${day}-${slot}`);
console.log(`warmup_text<<EOF\n${messages[slot]}\nEOF`);
