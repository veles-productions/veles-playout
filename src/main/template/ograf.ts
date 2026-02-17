/**
 * OGraf (EBU Web Component standard) template support.
 * Ported from veles-studio/src/lib/ografUtils.ts.
 *
 * Builds an inline HTML document that:
 * - Imports the OGraf ES module via <script type="module">
 * - Creates and mounts the custom element
 * - Calls load() / playAction() / stopAction() / updateAction()
 * - Listens for IPC commands from the main process
 */

export interface OGrafManifest {
  modulePath?: string;
  name?: string;
  version?: string;
  [key: string]: unknown;
}

interface OGrafTemplate {
  is_ograf?: boolean;
  ograf_manifest?: OGrafManifest | null;
  html_path?: string;
}

/** Check whether a template uses OGraf rendering */
export function isOGrafTemplate(template: OGrafTemplate | null | undefined): boolean {
  if (!template) return false;
  return !!(template.is_ograf || template.ograf_manifest);
}

/** Resolve the OGraf ES module path from manifest or html_path */
export function getOGrafModulePath(template: OGrafTemplate): string {
  const manifest = template.ograf_manifest;
  if (manifest?.modulePath) return manifest.modulePath;
  if (template.html_path) return template.html_path.replace(/\.html$/, '.mjs');
  return '';
}

/**
 * Build an OGraf host HTML document for rendering in an offscreen BrowserWindow.
 *
 * Uses the template:// custom protocol to load ES modules from the local cache.
 */
export function buildOGrafHostDoc(
  template: OGrafTemplate,
  fields: Record<string, string>,
  options: {
    cssOverrides?: string;
    bgOverride?: string;
    autoPlay?: boolean;
    baseUrl?: string;
  } = {},
): string {
  const { cssOverrides = '', bgOverride = '', autoPlay = true, baseUrl } = options;
  const modulePath = getOGrafModulePath(template);

  // Use template:// protocol for local cache, or absolute URL if remote
  const templateBase = baseUrl || 'template://ograf';
  const fullModulePath = modulePath.startsWith('http')
    ? modulePath
    : `${templateBase}/${modulePath}`;

  const dataJson = JSON.stringify(fields);
  const cssOverridesEscaped = cssOverrides.replace(/<\/style>/g, '<\\/style>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: ${bgOverride || 'transparent'};
    }
    #ograf-mount {
      width: 1920px;
      height: 1080px;
      position: relative;
      overflow: hidden;
    }
    ${cssOverridesEscaped}
  </style>
</head>
<body>
  <div id="ograf-mount"></div>
  <script type="module">
    let currentGraphic = null;

    async function init() {
      try {
        const mod = await import('${fullModulePath}');
        const GraphicClass = mod.default || mod[Object.keys(mod).find(k => k !== 'default')];
        if (!GraphicClass) throw new Error('No class in module');

        const tag = 'veles-ograf-' + Date.now();
        if (!customElements.get(tag)) customElements.define(tag, GraphicClass);

        const el = document.createElement(tag);
        document.getElementById('ograf-mount').appendChild(el);
        currentGraphic = el;

        await currentGraphic.load({
          data: ${dataJson},
          renderType: 'program',
          renderCharacteristics: { width: 1920, height: 1080, frameRate: 50 }
        });

        ${autoPlay ? "setTimeout(() => { if (currentGraphic) currentGraphic.playAction({}); }, 300);" : ''}
      } catch (err) {
        console.error('[OGraf Playout] Init failed:', err);
      }
    }

    // Message handler (OGraf + legacy)
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'ograf-play':
        case 'play':
          if (currentGraphic) currentGraphic.playAction(msg);
          break;
        case 'ograf-stop':
        case 'stop':
          if (currentGraphic) currentGraphic.stopAction(msg);
          break;
        case 'ograf-update':
        case 'updateGraphics':
        case 'update':
          if (currentGraphic) currentGraphic.updateAction({ data: msg.fields || msg.data || msg });
          break;
      }
    });

    // IPC bridge — called via webContents.executeJavaScript()
    window.__loadTemplate = function(payload) {
      // For OGraf, re-init is needed (reload the module)
      init();
    };

    window.__updateFields = function(fields) {
      if (currentGraphic) currentGraphic.updateAction({ data: fields });
    };

    window.__play = function() {
      if (currentGraphic) currentGraphic.playAction({});
    };

    window.__stop = function() {
      if (currentGraphic) currentGraphic.stopAction({});
    };

    window.__clear = function() {
      if (currentGraphic) currentGraphic.stopAction({});
      document.getElementById('ograf-mount').innerHTML = '';
      currentGraphic = null;
    };

    // Expose globals for compatibility
    window.play = () => { if (currentGraphic) currentGraphic.playAction({}); };
    window.stop = () => { if (currentGraphic) currentGraphic.stopAction({}); };
    window.update = (d) => {
      const parsed = typeof d === 'string' ? JSON.parse(d) : d;
      if (currentGraphic) currentGraphic.updateAction({ data: parsed });
    };
    window.updateGraphics = window.update;

    init();
  <\/script>
</body>
</html>`;
}
