/**
 * As-Run Log tests.
 *
 * Tests JSONL logging: daily file rotation, format, stream cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Mock fs module
vi.mock('fs', () => {
  const streams = new Map<string, { data: string[]; ended: boolean }>()

  return {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockImplementation((filePath: string) => {
      const stream = { data: [] as string[], ended: false }
      streams.set(filePath, stream)
      return {
        write: vi.fn((chunk: string) => { stream.data.push(chunk) }),
        end: vi.fn(() => { stream.ended = true }),
      }
    }),
    __streams: streams,
  }
})

import { AsRunLog } from '../main/as-run-log'

describe('AsRunLog', () => {
  let log: AsRunLog

  beforeEach(() => {
    vi.clearAllMocks()
    log = new AsRunLog()
  })

  afterEach(() => {
    log.destroy()
  })

  it('creates log directory if it does not exist', () => {
    ;(fs.existsSync as any).mockReturnValueOnce(false)
    new AsRunLog()
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('logs'),
      { recursive: true }
    )
  })

  it('writes JSONL format with timestamp', () => {
    log.write({ event: 'take', templateId: 'template-1' })

    expect(fs.createWriteStream).toHaveBeenCalled()
    const streamCalls = (fs.createWriteStream as any).mock.results
    const stream = streamCalls[streamCalls.length - 1].value
    expect(stream.write).toHaveBeenCalled()

    const written = stream.write.mock.calls[0][0] as string
    expect(written).toMatch(/\n$/) // ends with newline

    const parsed = JSON.parse(written.trim())
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.event).toBe('take')
    expect(parsed.templateId).toBe('template-1')
  })

  it('includes all entry fields in output', () => {
    log.write({
      event: 'load',
      templateId: 'tmpl-42',
      variables: { headline: 'Breaking' },
    })

    const stream = (fs.createWriteStream as any).mock.results[0].value
    const parsed = JSON.parse(stream.write.mock.calls[0][0].trim())

    expect(parsed.event).toBe('load')
    expect(parsed.templateId).toBe('tmpl-42')
    expect(parsed.variables).toEqual({ headline: 'Breaking' })
    expect(new Date(parsed.timestamp).getTime()).toBeGreaterThan(0)
  })

  it('creates file named with current date', () => {
    log.write({ event: 'clear' })

    const dateStr = new Date().toISOString().slice(0, 10)
    const callArgs = (fs.createWriteStream as any).mock.calls[0]
    expect(callArgs[0]).toContain(`as-run-${dateStr}.jsonl`)
    expect(callArgs[1]).toEqual({ flags: 'a' })
  })

  it('destroy() closes stream', () => {
    log.write({ event: 'take' })
    const stream = (fs.createWriteStream as any).mock.results[0].value

    log.destroy()
    expect(stream.end).toHaveBeenCalled()
  })

  it('getLogDir() returns log directory path', () => {
    const dir = log.getLogDir()
    expect(dir).toContain('logs')
  })

  it('handles multiple writes', () => {
    log.write({ event: 'load', templateId: 'a' })
    log.write({ event: 'take', templateId: 'a' })
    log.write({ event: 'clear' })

    const stream = (fs.createWriteStream as any).mock.results[0].value
    expect(stream.write).toHaveBeenCalledTimes(3)
  })
})
