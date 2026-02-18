/**
 * Template document builder.
 * Ports buildTemplateDoc() from veles-studio output/page.tsx.
 *
 * Builds a self-contained HTML document from template HTML + CSS,
 * with a postMessage bridge for field updates and play/stop commands.
 * Injects transparent background for alpha channel support.
 */

import type { TemplatePayload } from '../engine';

/**
 * Build a complete HTML document for rendering in an offscreen BrowserWindow.
 * Includes:
 * - Transparent background (for alpha channel extraction)
 * - postMessage bridge (for IPC-based field updates and play/stop)
 * - CSS overrides
 */
export function buildTemplateDoc(
  payload: TemplatePayload,
  options?: {
    cssOverrides?: string;
    bgOverride?: string;
  },
): string {
  const { templateHtml, templateCss } = payload;
  if (!templateHtml) return '';

  let doc = templateHtml;

  // Inject CSS overrides + transparent background into <head>
  const extraStyles: string[] = [];

  // Force transparent background for alpha extraction
  extraStyles.push(
    'html, body { background: transparent !important; }'
  );

  if (templateCss) extraStyles.push(templateCss);
  if (options?.cssOverrides) extraStyles.push(options.cssOverrides);
  if (options?.bgOverride) {
    extraStyles.push(
      `html, body { background: ${options.bgOverride} !important; }`
    );
  }

  if (extraStyles.length > 0) {
    const styleTag = `<style id="playout-overrides">${extraStyles.join('\n')}</style>`;
    if (doc.includes('</head>')) {
      doc = doc.replace('</head>', `${styleTag}</head>`);
    } else {
      doc = `<head>${styleTag}</head>${doc}`;
    }
  }

  // Inject postMessage bridge + IPC bridge for field updates and play/stop
  const bridge = `<script id="playout-bridge">
    // ── IPC bridge for Electron main process ──
    // These functions are called via webContents.executeJavaScript()

    window.__loadTemplate = function(payload) {
      // Template is already loaded as the document itself.
      // This is called after the srcDoc is set, so just store the variables.
      window.__currentVars = payload.variables || {};
      if (typeof window.update === 'function') window.update(window.__currentVars);
      else if (typeof window.updateGraphics === 'function') window.updateGraphics(window.__currentVars);
    };

    window.__updateFields = function(fields) {
      window.__currentVars = fields;
      if (typeof window.update === 'function') window.update(fields);
      else if (typeof window.updateGraphics === 'function') window.updateGraphics(fields);
    };

    window.__play = function() {
      if (typeof window.play === 'function') window.play();
    };

    window.__stop = function() {
      if (typeof window.stop === 'function') window.stop();
    };

    window.__next = function() {
      if (typeof window.next === 'function') window.next();
    };

    window.__clear = function() {
      if (typeof window.stop === 'function') window.stop();
      document.body.innerHTML = '';
    };

    // ── Legacy postMessage bridge (kept for compatibility) ──
    window.addEventListener('message', function(e) {
      var d = e.data; if (!d) return;
      if (d.type === 'updateGraphics' && d.fields) {
        if (typeof window.update === 'function') window.update(d.fields);
        else if (typeof window.updateGraphics === 'function') window.updateGraphics(d.fields);
      }
      if (d.type === 'play' && typeof window.play === 'function') window.play();
      if (d.type === 'stop' && typeof window.stop === 'function') window.stop();
    });
  <\/script>`;

  if (doc.includes('</body>')) {
    doc = doc.replace('</body>', `${bridge}</body>`);
  } else {
    doc += bridge;
  }

  return doc;
}
