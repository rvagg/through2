// example-ndjson.js
//
// Reads NDJSON log entries from stdin, filters by minimum level, pretty-prints
// matches to stdout, writes a summary to stderr. A small demonstration of
// composing through2 transforms with `node:stream/promises` `pipeline()`.
//
// Usage:
//   cat app.log | node example-ndjson.js [minLevel]
//
// Recognises common shapes for level / timestamp / logger / message fields,
// so it works with structured logs from zap (Go), pino (Node.js), bunyan,
// winston, and similar.

import { pipeline } from 'node:stream/promises'
import { objectTransform } from './through2.js'

const minLevel = (process.argv[2] || 'warn').toLowerCase()

// Map common level names + pino numeric levels to a single ordinal scale.
const levelNames = {
  trace: 0,
  debug: 1,
  info: 2,
  notice: 2,
  warn: 3,
  warning: 3,
  error: 4,
  err: 4,
  fatal: 5,
  crit: 5,
  critical: 5,
  panic: 5,
  dpanic: 5
}
const pinoNumeric = (n) =>
  n >= 60 ? 5 : n >= 50 ? 4 : n >= 40 ? 3 : n >= 30 ? 2 : n >= 20 ? 1 : 0
const lvlIdx = (l) =>
  typeof l === 'number' ? pinoNumeric(l) : levelNames[String(l).toLowerCase()] ?? 0

const minIdx = lvlIdx(minLevel)

let scanned = 0
let matched = 0
const byLogger = new Map()

await pipeline(
  process.stdin,

  // 1. Parse NDJSON: byte chunks in, objects out. The async generator handles
  //    line splitting across chunk boundaries.
  objectTransform(async function * (source) {
    let buf = ''
    for await (const chunk of source) {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        scanned++
        if (!line) continue
        try { yield JSON.parse(line) } catch { /* skip non-JSON */ }
      }
    }
    if (buf.trim()) try { yield JSON.parse(buf) } catch { /* skip non-JSON */ }
  }),

  // 2. Filter by minimum level. Returning undefined from an async transform
  //    drops the chunk.
  objectTransform(async (entry) =>
    lvlIdx(entry.level) >= minIdx ? entry : undefined
  ),

  // 3. Format each match as a one-line text record; tally as we go.
  objectTransform(async (entry) => {
    matched++
    const logger = entry.logger || entry.name || entry.component || '-'
    byLogger.set(logger, (byLogger.get(logger) || 0) + 1)
    const ts = String(entry.ts || entry.time || '').slice(0, 19).padEnd(19)
    const lvl = String(entry.level).padEnd(5).slice(0, 5)
    const msg = entry.msg || entry.message || ''
    return `${ts}  ${lvl}  ${logger.padEnd(20).slice(0, 20)}  ${msg}\n`
  }),

  process.stdout
)

const fmt = (n) => n.toLocaleString()
process.stderr.write('\n--\n')
process.stderr.write(`${fmt(scanned)} lines scanned, ${fmt(matched)} matched (level >= ${minLevel})\n`)
if (byLogger.size > 0) {
  process.stderr.write('top loggers:\n')
  for (const [k, v] of [...byLogger.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    process.stderr.write(`  ${fmt(v).padStart(8)}  ${k}\n`)
  }
}
