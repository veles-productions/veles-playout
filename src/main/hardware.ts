/**
 * Hardware detection for broadcast output devices.
 *
 * Probes for:
 * - SDI: Blackmagic DeckLink cards via macadam (optional native module)
 * - NDI: NewTek NDI runtime via grandiose (optional native module)
 * - Displays: Electron screen API for monitor enumeration
 */

import { screen } from 'electron';

export interface SdiDevice {
  index: number;
  modelName: string;
  displayName: string;
}

export interface HardwareInfo {
  sdi: {
    available: boolean;
    devices: SdiDevice[];
  };
  ndi: {
    available: boolean;
  };
  displays: Array<{
    id: number;
    label: string;
    width: number;
    height: number;
  }>;
}

/**
 * Detect available hardware outputs.
 * All probes are non-fatal — missing native modules just report unavailable.
 */
export async function detectHardware(): Promise<HardwareInfo> {
  return {
    sdi: await detectSdi(),
    ndi: detectNdi(),
    displays: detectDisplays(),
  };
}

async function detectSdi(): Promise<HardwareInfo['sdi']> {
  try {
    const macadam = require('macadam');
    const devices = await macadam.getDeviceInfo();
    return {
      available: true,
      devices: Array.isArray(devices)
        ? devices.map((d: any, i: number) => ({
            index: i,
            modelName: d.modelName || d.model || 'Unknown',
            displayName: d.displayName || d.name || `DeckLink ${i}`,
          }))
        : [],
    };
  } catch {
    return { available: false, devices: [] };
  }
}

function detectNdi(): HardwareInfo['ndi'] {
  try {
    require('grandiose');
    return { available: true };
  } catch {
    return { available: false };
  }
}

function detectDisplays(): HardwareInfo['displays'] {
  try {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || `${d.size.width}x${d.size.height}`,
      width: d.size.width,
      height: d.size.height,
    }));
  } catch {
    return [];
  }
}
