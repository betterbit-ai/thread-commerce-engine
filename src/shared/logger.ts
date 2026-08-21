const sensitivePattern = /token|secret|authorization|access.?key|api.?key/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitivePattern.test(key) ? '[REDACTED]' : redact(item),
      ]),
    );
  }
  return value;
}

export function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  context: Record<string, unknown> = {},
): void {
  const safeContext = redact(context) as Record<string, unknown>;
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...safeContext })}\n`,
  );
}
