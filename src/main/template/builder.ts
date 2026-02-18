/**
 * Template document builder.
 * Ports buildTemplateDoc() from veles-studio output/page.tsx.
 *
 * Builds a self-contained HTML document from template HTML + CSS,
 * with a postMessage bridge for field updates and play/stop commands.
 * Injects transparent background for alpha channel support.
 *
 * Variables are injected DIRECTLY into the bridge script as inline JSON
 * so they're applied during script execution — no postMessage race conditions.
 */

import type { TemplatePayload } from '../engine';

/**
 * Build a complete HTML document for rendering in an offscreen BrowserWindow.
 * Includes:
 * - Transparent background (for alpha channel extraction)
 * - Direct variable injection (applied immediately on load)
 * - postMessage bridge (for live field updates and play/stop)
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

  // Serialize variables as JSON for direct injection into the bridge script.
  // Escape </script> sequences in the JSON to prevent premature script tag closing.
  const varsJson = JSON.stringify(payload.variables || {}).replace(/<\//g, '<\\/');

  // Inject bridge script with direct variable injection + postMessage for live updates.
  // The bridge runs AFTER all template scripts (caspar.js, registerPlay, etc.) since
  // it's injected just before </body>. By this point window.update and window.play
  // are guaranteed to be defined.
  const bridge = `<script id="playout-bridge">
    // ── Direct variable injection — applied immediately, no postMessage needed ──
    (function() {
      var __vars = ${varsJson};
      if (__vars && Object.keys(__vars).length > 0) {
        if (typeof window.update === 'function') window.update(__vars);
        else if (typeof window.updateGraphics === 'function') window.updateGraphics(__vars);
      }
    })();

    // ── IPC bridge for Electron main process ──
    // These functions are called via webContents.executeJavaScript() or postMessage

    window.__currentVars = ${varsJson};

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

    // ── postMessage bridge for live updates from host page ──
    window.addEventListener('message', function(e) {
      var d = e.data; if (!d) return;
      if (d.type === 'updateGraphics' && d.fields) {
        window.__currentVars = d.fields;
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
