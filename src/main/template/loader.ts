/**
 * Template loader — fetches templates from veles-core API and caches locally.
 *
 * Cache strategy:
 * - Templates stored in app.getPath('userData')/templates/
 * - Cache key = templateId + updated_at hash
 * - LRU eviction when cache exceeds configurable max size
 */

import { app, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../config';
import { getCacheDir } from './paths';

interface TemplateApiResponse {
  id: number;
  name: string;
  html: string;
  css: string;
  html_path?: string;
  is_ograf?: boolean;
  ograf_manifest?: Record<string, unknown> | null;
  variables?: Array<{
    key: string;
    label: string;
    type: string;
    defaultValue?: string;
    options?: string[];
  }>;
  updated_at?: string;
}

interface CacheEntry {
  templateId: string;
  filePath: string;
  size: number;
  lastAccessed: number;
  updatedAt: string;
}

interface CacheIndex {
  entries: CacheEntry[];
}

const CACHE_INDEX_FILE = 'cache-index.json';

/** Ensure cache directory exists */
function ensureCacheDir(): string {
  const dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Load the cache index */
function loadCacheIndex(): CacheIndex {
  const indexPath = path.join(getCacheDir(), CACHE_INDEX_FILE);
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch {
    // corrupted index, start fresh
  }
  return { entries: [] };
}

/** Save the cache index */
function saveCacheIndex(index: CacheIndex): void {
  const indexPath = path.join(getCacheDir(), CACHE_INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/** Get total cache size in bytes */
function getCacheSize(index: CacheIndex): number {
  return index.entries.reduce((sum, e) => sum + e.size, 0);
}

/** Evict LRU entries until cache is under max size */
function evictLRU(index: CacheIndex, maxBytes: number): void {
  // Sort by lastAccessed ascending (oldest first)
  index.entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

  while (getCacheSize(index) > maxBytes && index.entries.length > 0) {
    const entry = index.entries.shift()!;
    try {
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
      }
    } catch {
      // ignore deletion errors
    }
  }

  saveCacheIndex(index);
}

/**
 * Fetch a template from the veles-core API.
 * Returns null if the request fails.
 */
export async function fetchTemplate(
  templateId: string,
): Promise<TemplateApiResponse | null> {
  const { apiUrl } = getConfig();
  const url = `${apiUrl}/templates/${templateId}`;

  try {
    const response = await net.fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as TemplateApiResponse;
  } catch (err) {
    console.error(`[TemplateLoader] Failed to fetch template ${templateId}:`, err);
    return null;
  }
}

/**
 * Get a template from cache or fetch from API.
 * Handles caching and LRU eviction.
 */
export async function getTemplate(
  templateId: string,
): Promise<TemplateApiResponse | null> {
  const cacheDir = ensureCacheDir();
  const index = loadCacheIndex();
  const { cacheMaxBytes } = getConfig();

  // Check cache
  const cached = index.entries.find((e) => e.templateId === templateId);
  if (cached && fs.existsSync(cached.filePath)) {
    // Update last accessed time
    cached.lastAccessed = Date.now();
    saveCacheIndex(index);

    try {
      return JSON.parse(fs.readFileSync(cached.filePath, 'utf-8'));
    } catch {
      // corrupted cache entry, will re-fetch
    }
  }

  // Fetch from API
  const template = await fetchTemplate(templateId);
  if (!template) return null;

  // Save to cache
  const filePath = path.join(cacheDir, `template-${templateId}.json`);
  const content = JSON.stringify(template);
  fs.writeFileSync(filePath, content);

  // Update index
  const size = Buffer.byteLength(content);
  const existingIdx = index.entries.findIndex((e) => e.templateId === templateId);
  const entry: CacheEntry = {
    templateId,
    filePath,
    size,
    lastAccessed: Date.now(),
    updatedAt: template.updated_at || '',
  };

  if (existingIdx >= 0) {
    index.entries[existingIdx] = entry;
  } else {
    index.entries.push(entry);
  }

  // Evict if over limit
  if (getCacheSize(index) > cacheMaxBytes) {
    evictLRU(index, cacheMaxBytes);
  } else {
    saveCacheIndex(index);
  }

  return template;
}

/**
 * Cache an OGraf module file locally.
 * Returns the local file path.
 */
export async function cacheOGrafModule(
  modulePath: string,
  content: string,
): Promise<string> {
  const cacheDir = ensureCacheDir();
  const ografDir = path.join(cacheDir, 'ograf');
  if (!fs.existsSync(ografDir)) {
    fs.mkdirSync(ografDir, { recursive: true });
  }

  const filePath = path.join(ografDir, modulePath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

/** Clear entire template cache */
export function clearCache(): void {
  const cacheDir = getCacheDir();
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  saveCacheIndex({ entries: [] });
}
