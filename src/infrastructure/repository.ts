import { mkdir, readFile, rename, writeFile, appendFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';

export class RepositoryStore {
  constructor(readonly root = resolve('.')) {}
  path(relative: string): string {
    return join(this.root, relative);
  }
  async readJson<T>(relative: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(await readFile(this.path(relative), 'utf8')));
  }
  async writeJson(relative: string, value: unknown): Promise<void> {
    const path = this.path(relative);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  }
  async appendJsonl(relative: string, value: unknown): Promise<void> {
    const path = this.path(relative);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  }
  async writeJsonl(relative: string, values: unknown[]): Promise<void> {
    const path = this.path(relative);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(
      temp,
      values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''),
      { mode: 0o600 },
    );
    await rename(temp, path);
  }
  async readJsonl<T>(relative: string, schema: z.ZodType<T>): Promise<T[]> {
    try {
      return (await readFile(this.path(relative), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => schema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async readJsonlTree<T>(relative: string, schema: z.ZodType<T>): Promise<T[]> {
    try {
      const entries = await readdir(this.path(relative), { recursive: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.endsWith('.jsonl'))
          .map((entry) => this.readJsonl(join(relative, entry), schema)),
      );
      return records.flat();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async list(relative: string): Promise<string[]> {
    try {
      return await readdir(this.path(relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
