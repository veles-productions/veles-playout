/**
 * Patch macadam's binding.gyp for Electron 35+ NAPI compatibility.
 *
 * Electron 35 enables NAPI_EXPERIMENTAL which changes the finalize callback
 * signature (napi_env -> node_api_nogc_env). macadam's C++ code uses the old
 * signature, causing compilation to fail.
 *
 * Fix: add NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT define to the Windows build
 * target, which restores the old napi_finalize typedef.
 *
 * This script is idempotent — safe to run multiple times.
 */

const fs = require('fs');
const path = require('path');

const gypPath = path.join(__dirname, '..', 'node_modules', 'macadam', 'binding.gyp');

if (!fs.existsSync(gypPath)) {
  console.log('[patch-macadam] macadam not installed (optional dep), skipping.');
  process.exit(0);
}

let content = fs.readFileSync(gypPath, 'utf8');

if (content.includes('NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT')) {
  console.log('[patch-macadam] Already patched, skipping.');
  process.exit(0);
}

// Insert "defines" block into the Windows target, right after the sources array
const marker = `"decklink/Win/include/DeckLinkAPI_i.c" ],`;
const patch = `"decklink/Win/include/DeckLinkAPI_i.c" ],
        "defines": [
          "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT"
        ],`;

if (!content.includes(marker)) {
  console.error('[patch-macadam] Could not find insertion point in binding.gyp.');
  console.error('[patch-macadam] macadam version may have changed — manual patch needed.');
  process.exit(1);
}

content = content.replace(marker, patch);
fs.writeFileSync(gypPath, content, 'utf8');
console.log('[patch-macadam] Patched binding.gyp with NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT.');
