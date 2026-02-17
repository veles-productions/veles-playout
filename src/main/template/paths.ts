/**
 * Template path resolution.
 * Handles URL rewriting for local cache and custom protocol.
 */

import { app } from 'electron';
import * as path from 'path';

/** Base directory for cached templates */
export function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'templates');
}

/** Resolve a template asset path to the local cache */
export function resolveTemplatePath(relativePath: string): string {
  return path.join(getCacheDir(), relativePath);
}

/**
 * Rewrite asset URLs in template HTML to use the custom template:// protocol.
 * This ensures all CSS, images, JS, and fonts load from the local cache.
 */
export function rewriteAssetUrls(html: string, templateId: string): string {
  let doc = html;

  // Rewrite relative paths in src attributes
  doc = doc.replace(
    /(?:src|href)=["'](?!https?:\/\/|data:|blob:|template:\/\/|#)(.*?)["']/g,
    (match, url) => {
      const protocol = `template://${templateId}/${url}`;
      return match.replace(url, protocol);
    }
  );

  // Rewrite url() in CSS
  doc = doc.replace(
    /url\(["']?(?!https?:\/\/|data:|blob:|template:\/\/)(.*?)["']?\)/g,
    (match, url) => {
      const protocol = `template://${templateId}/${url}`;
      return match.replace(url, protocol);
    }
  );

  return doc;
}

/**
 * Rewrite ES module import paths for OGraf templates.
 * Converts relative imports to template:// protocol.
 */
export function rewriteModuleImports(
  moduleCode: string,
  templateId: string,
): string {
  return moduleCode.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, importPath) => {
      return match.replace(importPath, `template://${templateId}/${importPath}`);
    }
  );
}
