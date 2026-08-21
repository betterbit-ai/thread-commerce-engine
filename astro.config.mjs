import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './storefront',
  publicDir: './public',
  output: 'static',
  site: process.env.SITE_URL || 'https://example.github.io',
  base: process.env.SITE_BASE || '/thread-commerce-engine',
  build: { assets: 'assets' },
});
