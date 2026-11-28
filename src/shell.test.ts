import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** Files are served from `public/` under their URL path, except the html entry point. */
function publicFile(path: string): string | null {
  if (path === '/' || path === '/index.html') return 'index.html';
  return join('public', path.replace(/^\//, ''));
}

const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

describe('installable app shell', () => {
  it('has the manifest entries a browser needs to offer installation', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toContain('Sheet Set Pro');
    expect(manifest.short_name.length).toBeLessThanOrEqual(13);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ships every icon the manifest promises', () => {
    for (const icon of manifest.icons) {
      const file = publicFile(icon.src);
      expect(file, `icon ${icon.src} is not under public/`).not.toBeNull();
      expect(existsSync(join(root, file as string)), `missing ${icon.src}`).toBe(true);
      if (icon.type === 'image/png') {
        const bytes = readFileSync(join(root, file as string));
        const width = bytes.readUInt32BE(16);
        const height = bytes.readUInt32BE(20);
        expect(`${width}x${height}`, `${icon.src} pixels`).toBe(icon.sizes);
        expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      }
    }
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('links the manifest and the touch icon from the html', () => {
    const html = read('index.html');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color"');
  });

  it('pre-caches only shell files that exist and never caches the database', () => {
    const sw = read('public/sw.js');
    const shell = /const SHELL = \[([^\]]+)\]/.exec(sw);
    expect(shell, 'sw.js should declare its shell').not.toBeNull();
    const paths = [...(shell as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(2);
    for (const path of paths) {
      const file = publicFile(path);
      expect(file, `${path} has no file behind it`).not.toBeNull();
      expect(existsSync(join(root, file as string)), `missing ${path}`).toBe(true);
    }
    expect(sw).toContain("url.pathname.startsWith('/rest/')");
    expect(/onst CACHE = '[^']+v\d+/.test(sw), 'the cache name should carry a version').toBe(true);
  });
});
