/**
 * Built-in broadcast test signal generators.
 *
 * Each pattern returns a self-contained HTML document that flows through
 * the same engine path as real templates — load to PVW, TAKE to PGM,
 * captured and routed to all outputs (SDI/NDI/window).
 */

export type TestPattern = 'smpte' | 'bars' | 'grid' | 'ramp';

export interface TestPatternMeta {
  id: TestPattern;
  label: string;
  description: string;
}

export const TEST_PATTERNS: TestPatternMeta[] = [
  { id: 'smpte', label: 'SMPTE', description: 'SMPTE EG 1-1990 color bars' },
  { id: 'bars', label: 'Bars', description: '100% intensity 8-column bars' },
  { id: 'grid', label: 'Grid', description: 'Crosshatch grid with safe-area markers' },
  { id: 'ramp', label: 'Ramp', description: 'Horizontal grayscale gradient' },
];

/**
 * Generate a test signal HTML document for a given pattern.
 *
 * @param pattern - Which test pattern to generate
 * @param alpha - If true, background is transparent (for key signal testing)
 * @returns Complete HTML document string with template bridge functions
 */
export function generateTestSignal(pattern: TestPattern, alpha?: boolean): string {
  const bg = alpha ? 'transparent' : '#000';
  let body = '';

  switch (pattern) {
    case 'smpte':
      body = smpteBody(alpha);
      break;
    case 'bars':
      body = barsBody(alpha);
      break;
    case 'grid':
      body = gridBody(alpha);
      break;
    case 'ramp':
      body = rampBody(alpha);
      break;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: ${bg}; }
  .ts-label {
    position: absolute; bottom: 20px; right: 20px;
    font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold;
    color: rgba(255,255,255,0.6); text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
    text-align: right; line-height: 1.4; pointer-events: none; z-index: 10;
  }
</style>
</head>
<body>
${body}
<div class="ts-label">${pattern.toUpperCase()} TEST SIGNAL</div>
<script>
  // Template bridge — no-ops for test signals
  window.__loadTemplate = function() {};
  window.__updateFields = function() {};
  window.__play = function() {};
  window.__stop = function() {};
  window.__clear = function() { document.body.innerHTML = ''; };
  window.addEventListener('message', function() {});
</script>
</body>
</html>`;
}

// ── SMPTE EG 1-1990 Color Bars ──
// Row 1 (67%): 75% intensity bars (gray, yellow, cyan, green, magenta, red, blue)
// Row 2 (8%):  complement bars (blue, black, magenta, black, cyan, black, gray)
// Row 3 (25%): PLUGE (-4% black, 0%, +4% black, then 100% white, 0%, black)

function smpteBody(alpha?: boolean): string {
  return `<style>
  .smpte { display: flex; flex-direction: column; width: 100%; height: 100%; }
  .smpte-row { display: flex; width: 100%; }
  .smpte-row1 { height: 67%; }
  .smpte-row2 { height: 8%; }
  .smpte-row3 { height: 25%; display: flex; }
  .smpte-row .bar { flex: 1; }
  /* Row 1 — 75% intensity */
  .bar-gray    { background: #BFBFBF; }
  .bar-yellow  { background: #BFBF00; }
  .bar-cyan    { background: #00BFBF; }
  .bar-green   { background: #00BF00; }
  .bar-magenta { background: #BF00BF; }
  .bar-red     { background: #BF0000; }
  .bar-blue    { background: #0000BF; }
  /* Row 2 — complement */
  .bar-blue2   { background: #0000BF; }
  .bar-black   { background: #000; }
  .bar-mag2    { background: #BF00BF; }
  .bar-cyan2   { background: #00BFBF; }
  .bar-gray2   { background: #BFBFBF; }
  /* Row 3 — PLUGE */
  .pluge { display: flex; height: 100%; }
  .pluge-neg   { background: #040404; width: 12.5%; }
  .pluge-zero  { background: #000; width: 12.5%; }
  .pluge-pos   { background: #0A0A0A; width: 12.5%; }
  .pluge-white { background: #FFF; width: 25%; }
  .pluge-mid   { background: #000; width: 25%; }
  .pluge-black { background: #000; width: 12.5%; }
</style>
<div class="smpte">
  <div class="smpte-row smpte-row1">
    <div class="bar bar-gray"></div>
    <div class="bar bar-yellow"></div>
    <div class="bar bar-cyan"></div>
    <div class="bar bar-green"></div>
    <div class="bar bar-magenta"></div>
    <div class="bar bar-red"></div>
    <div class="bar bar-blue"></div>
  </div>
  <div class="smpte-row smpte-row2">
    <div class="bar bar-blue2"></div>
    <div class="bar bar-black"></div>
    <div class="bar bar-mag2"></div>
    <div class="bar bar-black"></div>
    <div class="bar bar-cyan2"></div>
    <div class="bar bar-black"></div>
    <div class="bar bar-gray2"></div>
  </div>
  <div class="smpte-row3 pluge">
    <div class="pluge-neg"></div>
    <div class="pluge-zero"></div>
    <div class="pluge-pos"></div>
    <div class="pluge-white"></div>
    <div class="pluge-mid"></div>
    <div class="pluge-black"></div>
  </div>
</div>`;
}

// ── 100% Bars ──
// 8 columns: White, Yellow, Cyan, Green, Magenta, Red, Blue, Black

function barsBody(alpha?: boolean): string {
  const colors = ['#FFF', '#FF0', '#0FF', '#0F0', '#F0F', '#F00', '#00F', '#000'];
  const divs = colors.map((c) => `<div class="bar" style="background:${c}"></div>`).join('\n    ');

  return `<style>
  .bars { display: flex; width: 100%; height: 100%; }
  .bars .bar { flex: 1; }
</style>
<div class="bars">
    ${divs}
</div>`;
}

// ── Grid ──
// White crosshatch grid on black + center cross + title/action safe markers

function gridBody(alpha?: boolean): string {
  const bg = alpha ? 'transparent' : '#000';
  return `<style>
  .grid-container {
    width: 100%; height: 100%; position: relative;
    background: ${bg};
  }
  .grid-lines {
    position: absolute; inset: 0;
    background:
      repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(255,255,255,0.25) 59px, rgba(255,255,255,0.25) 60px),
      repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(255,255,255,0.25) 59px, rgba(255,255,255,0.25) 60px);
  }
  .center-cross {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
  }
  .center-cross::before, .center-cross::after {
    content: ''; position: absolute; background: rgba(255,255,255,0.8);
  }
  .center-cross::before { width: 80px; height: 2px; top: -1px; left: -40px; }
  .center-cross::after  { width: 2px; height: 80px; top: -40px; left: -1px; }
  .safe-title {
    position: absolute;
    top: 10%; left: 10%; right: 10%; bottom: 10%;
    border: 1px solid rgba(255,255,255,0.4);
  }
  .safe-action {
    position: absolute;
    top: 5%; left: 5%; right: 5%; bottom: 5%;
    border: 1px dashed rgba(255,255,255,0.2);
  }
  .safe-label {
    position: absolute; font-family: 'Courier New', monospace;
    font-size: 10px; color: rgba(255,255,255,0.35);
  }
  .safe-label.title-label { top: calc(10% - 14px); left: 10%; }
  .safe-label.action-label { top: calc(5% - 14px); left: 5%; }
</style>
<div class="grid-container">
  <div class="grid-lines"></div>
  <div class="safe-action"></div>
  <div class="safe-title"></div>
  <span class="safe-label title-label">TITLE SAFE (90%)</span>
  <span class="safe-label action-label">ACTION SAFE (95%)</span>
  <div class="center-cross"></div>
</div>`;
}

// ── Ramp ──
// Horizontal grayscale gradient (black → white)

function rampBody(alpha?: boolean): string {
  const bg = alpha ? 'transparent' : '#000';
  return `<style>
  .ramp {
    width: 100%; height: 100%;
    background: linear-gradient(to right, #000 0%, #FFF 100%);
  }
</style>
<div class="ramp"></div>`;
}
