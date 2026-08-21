import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ValidationError } from '../shared/errors.js';

export async function loadPrompt(
  stage: string,
  version = 'v1',
): Promise<{ text: string; version: string; hash: string }> {
  if (!/^[a-z-]+$/u.test(stage) || !/^v\d+$/u.test(version))
    throw new ValidationError('Invalid prompt identifier');
  const text = await readFile(resolve('prompts', stage, `${version}.md`), 'utf8');
  return { text, version, hash: createHash('sha256').update(text).digest('hex') };
}
