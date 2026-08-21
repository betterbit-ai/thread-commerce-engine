import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { LlmPort, StructuredRequest } from '../application/ports.js';
import { ConfigurationError, ValidationError } from '../shared/errors.js';
import { requestJson } from './http.js';

const completionSchema = z
  .object({
    choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  })
  .passthrough();
export function llmInputHash(
  request: Pick<StructuredRequest<unknown>, 'task' | 'prompt' | 'input' | 'model'>,
): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

export interface GroqOptions {
  apiKey: string;
  timeoutMs: number;
  attempts: number;
  cacheDir?: string;
  fetchFn?: typeof fetch;
}
export class GroqClient implements LlmPort {
  constructor(private readonly options: GroqOptions) {
    if (!options.apiKey) throw new ConfigurationError('GROQ_API_KEY is required');
  }
  async checkConnectivity(): Promise<{ ok: boolean; detail: string }> {
    return {
      ok: true,
      detail: 'credential configured; request verification occurs in live contract test',
    };
  }
  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const hash = llmInputHash(request);
    const cachePath = resolve(this.options.cacheDir ?? 'data/cache/groq', `${hash}.json`);
    try {
      return request.parse(JSON.parse(await readFile(cachePath, 'utf8')));
    } catch {
      /* cache miss or stale */
    }
    let validationError: unknown;
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      const result = await requestJson(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            temperature: request.temperature,
            max_completion_tokens: request.maxTokens,
            messages: [
              { role: 'system', content: request.prompt },
              { role: 'user', content: JSON.stringify(request.input) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: request.schemaName, strict: false, schema: request.jsonSchema },
            },
          }),
        },
        {
          timeoutMs: this.options.timeoutMs,
          attempts: this.options.attempts,
          allowUnsafeRetries: true,
          ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
        },
      );
      try {
        const completion = completionSchema.parse(result.data);
        const content = completion.choices[0]?.message.content;
        if (!content) throw new ValidationError('Groq response had no content');
        const parsed = request.parse(JSON.parse(content) as unknown);
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, `${JSON.stringify(parsed)}\n`);
        return parsed;
      } catch (error) {
        validationError = error;
        if (attempt === this.options.attempts) break;
      }
    }
    throw validationError instanceof Error
      ? validationError
      : new ValidationError('Groq structured response could not be validated');
  }
}
