/**
 * Template builder tests.
 *
 * Tests buildTemplateDoc() — pure function, no Electron needed.
 */

import { describe, it, expect } from 'vitest'
import { buildTemplateDoc } from '../main/template/builder'
import type { TemplatePayload } from '../main/engine'

describe('buildTemplateDoc', () => {
  const basePayload: TemplatePayload = {
    templateHtml: '<!DOCTYPE html><html><head></head><body><h1>Hello</h1></body></html>',
    templateCss: 'h1 { color: blue; }',
    variables: { name: 'World' },
    templateId: 'test-1',
  }

  it('returns empty string for empty templateHtml', () => {
    const result = buildTemplateDoc({ ...basePayload, templateHtml: '' })
    expect(result).toBe('')
  })

  it('injects transparent background CSS', () => {
    const result = buildTemplateDoc(basePayload)
    expect(result).toContain('background: transparent !important')
  })

  it('injects template CSS into head', () => {
    const result = buildTemplateDoc(basePayload)
    expect(result).toContain('h1 { color: blue; }')
  })

  it('injects playout bridge script before </body>', () => {
    const result = buildTemplateDoc(basePayload)
    expect(result).toContain('playout-bridge')
    expect(result).toContain('window.__loadTemplate')
    expect(result).toContain('window.__updateFields')
    expect(result).toContain('window.__play')
    expect(result).toContain('window.__stop')
    expect(result).toContain('window.__clear')
  })

  it('bridge script includes postMessage listener', () => {
    const result = buildTemplateDoc(basePayload)
    expect(result).toContain("window.addEventListener('message'")
  })

  it('injects CSS overrides when provided', () => {
    const result = buildTemplateDoc(basePayload, { cssOverrides: '.custom { margin: 10px; }' })
    expect(result).toContain('.custom { margin: 10px; }')
  })

  it('injects background override when provided', () => {
    const result = buildTemplateDoc(basePayload, { bgOverride: '#ff0000' })
    expect(result).toContain('#ff0000')
  })

  it('handles HTML without <head> tag', () => {
    const payload: TemplatePayload = {
      ...basePayload,
      templateHtml: '<div>No head tag</div>',
    }
    const result = buildTemplateDoc(payload)
    expect(result).toContain('<head>')
    expect(result).toContain('playout-overrides')
  })

  it('handles HTML without </body> tag', () => {
    const payload: TemplatePayload = {
      ...basePayload,
      templateHtml: '<html><head></head><div>No body end</div></html>',
    }
    const result = buildTemplateDoc(payload)
    expect(result).toContain('playout-bridge')
  })

  it('preserves original HTML structure', () => {
    const result = buildTemplateDoc(basePayload)
    expect(result).toContain('<h1>Hello</h1>')
    expect(result).toContain('<!DOCTYPE html>')
  })

  it('handles undefined templateCss', () => {
    const payload: TemplatePayload = {
      ...basePayload,
      templateCss: undefined,
    }
    const result = buildTemplateDoc(payload)
    // Should still have transparent bg
    expect(result).toContain('background: transparent !important')
    // But no extra template CSS
    expect(result).not.toContain('h1 { color: blue; }')
  })
})
