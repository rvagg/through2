import { Readable } from 'readable-stream'
import through2, {
  transform,
  objectTransform,
  transformer
} from '../through2.js'

const decoder = new TextDecoder('ascii')
const encoder = new TextEncoder()

const eq = (actual, expected, msg) => {
  if (actual !== expected) {
    throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const deepEq = (actual, expected, msg) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'deepEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const ok = (val, msg) => {
  if (!val) throw new Error(msg || 'expected truthy')
}

function randomBytes (len) {
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function collect (stream) {
  return new Promise((resolve, reject) => {
    /** @type {Uint8Array[]} */
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      let total = 0
      for (const c of chunks) total += c.length
      const out = new Uint8Array(total)
      let i = 0
      for (const c of chunks) { out.set(c, i); i += c.length }
      resolve(out)
    })
    stream.on('error', reject)
  })
}

function collectObjects (stream) {
  return new Promise((resolve, reject) => {
    const objs = []
    stream.on('data', (o) => objs.push(o))
    stream.on('end', () => resolve(objs))
    stream.on('error', reject)
  })
}

export async function classicByteTransform () {
  const stream = transform(function (chunk, _enc, cb) {
    if (!this._i) this._i = 97
    else this._i++
    const out = new Uint8Array(chunk.length)
    out.fill(this._i)
    this.push(out)
    cb()
  })
  const done = collect(stream)
  stream.write(randomBytes(10))
  stream.write(randomBytes(5))
  stream.write(randomBytes(10))
  stream.end()
  eq(decoder.decode(await done), 'aaaaaaaaaabbbbbcccccccccc')
}

export async function classicNoopTransform () {
  const stream = transform()
  const done = collect(stream)
  stream.end(encoder.encode('eeee'))
  eq(decoder.decode(await done), 'eeee')
}

export async function classicFlush () {
  const stream = transform(
    function (chunk, _enc, cb) {
      if (!this._i) this._i = 97
      else this._i++
      const out = new Uint8Array(chunk.length)
      out.fill(this._i)
      this.push(out)
      cb()
    },
    function (cb) {
      this.push(encoder.encode('end'))
      cb()
    }
  )
  const done = collect(stream)
  stream.write(randomBytes(10))
  stream.write(randomBytes(5))
  stream.write(randomBytes(10))
  stream.end()
  eq(decoder.decode(await done), 'aaaaaaaaaabbbbbccccccccccend')
}

export async function classicCallbackShorthand () {
  const stream = transform((chunk, _enc, cb) => cb(null, chunk))
  const done = collect(stream)
  stream.end(encoder.encode('hello'))
  eq(decoder.decode(await done), 'hello')
}

export async function asyncReturnedValuePushed () {
  const stream = transform(async (_chunk, _enc) => encoder.encode('X'))
  const done = collect(stream)
  stream.write(new Uint8Array([1]))
  stream.write(new Uint8Array([2]))
  stream.end()
  eq(decoder.decode(await done), 'XX')
}

export async function asyncUndefinedSkipsEmission () {
  const stream = objectTransform(async (chunk) => chunk % 2 === 0 ? chunk : undefined)
  const done = collectObjects(stream)
  for (let i = 0; i < 6; i++) stream.write(i)
  stream.end()
  deepEq(await done, [0, 2, 4])
}

export async function asyncRejectedPropagatesError () {
  const stream = transform(async () => { throw new Error('boom') })
  stream.write(new Uint8Array([1]))
  await new Promise((resolve, reject) => {
    stream.on('error', (err) => {
      try { eq(err.message, 'boom'); resolve() } catch (e) { reject(e) }
    })
  })
}

export async function asyncgenOneToOne () {
  const stream = objectTransform(async function * (source) {
    for await (const chunk of source) yield chunk * 2
  })
  const done = collectObjects(stream)
  for (let i = 1; i <= 4; i++) stream.write(i)
  stream.end()
  deepEq(await done, [2, 4, 6, 8])
}

export async function asyncgenFanOut () {
  const stream = objectTransform(async function * (source) {
    for await (const chunk of source) {
      yield chunk
      yield chunk
    }
  })
  const done = collectObjects(stream)
  stream.write('a')
  stream.write('b')
  stream.end()
  deepEq(await done, ['a', 'a', 'b', 'b'])
}

export async function asyncgenFilter () {
  const stream = objectTransform(async function * (source) {
    for await (const chunk of source) {
      if (chunk % 2 === 0) yield chunk
    }
  })
  const done = collectObjects(stream)
  for (let i = 0; i < 6; i++) stream.write(i)
  stream.end()
  deepEq(await done, [0, 2, 4])
}

export async function asyncgenWithClassicFlush () {
  const stream = objectTransform(
    async function * (source) {
      for await (const chunk of source) yield chunk
    },
    function (cb) { this.push('END'); cb() }
  )
  const done = collectObjects(stream)
  stream.write('a')
  stream.write('b')
  stream.end()
  deepEq(await done, ['a', 'b', 'END'])
}

export async function asyncgenThrownPropagates () {
  const stream = objectTransform(async function * () {
    throw new Error('gen-boom')
  })
  stream.write('x')
  stream.end()
  await new Promise((resolve, reject) => {
    stream.on('error', (err) => {
      try { eq(err.message, 'gen-boom'); resolve() } catch (e) { reject(e) }
    })
  })
}

export async function objectTransformPassthrough () {
  const stream = objectTransform(function (chunk, _enc, cb) {
    this.push({ out: chunk.in + 1 })
    cb()
  })
  const done = collectObjects(stream)
  stream.write({ in: 1 })
  stream.write({ in: 2 })
  stream.write({ in: 3 })
  stream.end()
  deepEq(await done, [{ out: 2 }, { out: 3 }, { out: 4 }])
}

export async function objectTransformFromReadable () {
  const source = Readable.from([
    { temp: -2.2, unit: 'F' },
    { temp: -40, unit: 'F' },
    { temp: 212, unit: 'F' },
    { temp: 22, unit: 'C' }
  ])
  const conv = objectTransform(async (record) => {
    if (record.unit === 'F') {
      record = { temp: ((record.temp - 32) * 5) / 9, unit: 'C' }
    }
    return record
  })
  source.pipe(conv)
  const out = await collectObjects(conv)
  deepEq(out.map((r) => Math.round(r.temp)), [-19, -40, 100, 22])
  ok(out.every((r) => r.unit === 'C'))
}

export async function transformerReusableFactory () {
  const Th = transformer(function (chunk, _enc, cb) {
    if (!this._i) this._i = 97
    else this._i++
    const out = new Uint8Array(chunk.length)
    out.fill(this._i)
    this.push(out)
    cb()
  })

  const a = new Th()
  const b = Th()

  const da = collect(a); const db = collect(b)
  a.write(randomBytes(3)); a.write(randomBytes(2)); a.end()
  b.write(randomBytes(2)); b.write(randomBytes(3)); b.end()

  eq(decoder.decode(await da), 'aaabb')
  eq(decoder.decode(await db), 'aabbb')
}

export async function transformerOptionsMerge () {
  const Th = transformer({ objectMode: true, peek: true }, function (chunk, _enc, cb) {
    ok(this.options.peek, 'options visible inside transform')
    this.push({ out: chunk.in + 1 })
    cb()
  })
  const inst = Th()
  const done = collectObjects(inst)
  inst.write({ in: 1 })
  inst.write({ in: 2 })
  inst.end()
  deepEq(await done, [{ out: 2 }, { out: 3 }])
}

export async function transformerOverrideOptions () {
  const Th = transformer(function (chunk, _enc, cb) {
    this.push({ out: chunk.in + 1 })
    cb()
  })
  const inst = Th({ objectMode: true })
  const done = collectObjects(inst)
  inst.write({ in: 10 })
  inst.end()
  deepEq(await done, [{ out: 11 }])
}

export async function transformerAsyncSupported () {
  const Th = transformer({ objectMode: true }, async (chunk) => chunk * 10)
  const inst = Th()
  const done = collectObjects(inst)
  inst.write(1); inst.write(2); inst.end()
  deepEq(await done, [10, 20])
}

export async function legacyDefault () {
  const stream = through2((chunk, _enc, cb) => cb(null, chunk))
  const done = collect(stream)
  stream.end(encoder.encode('legacy'))
  eq(decoder.decode(await done), 'legacy')
}

export async function legacyDefaultObj () {
  const stream = through2.obj(function (chunk, _enc, cb) {
    this.push({ out: chunk.in + 1 })
    cb()
  })
  const done = collectObjects(stream)
  stream.write({ in: 1 })
  stream.end()
  deepEq(await done, [{ out: 2 }])
}

export async function legacyDefaultCtor () {
  const Th = through2.ctor({ objectMode: true }, function (chunk, _enc, cb) {
    this.push({ out: chunk.in + 1 })
    cb()
  })
  const inst = new Th()
  const done = collectObjects(inst)
  inst.write({ in: 5 })
  inst.end()
  deepEq(await done, [{ out: 6 }])
}

export async function transformerAsyncgenSupported () {
  // Each call gets its own generator pipeline.
  const Doubled = transformer({ objectMode: true }, async function * (source) {
    for await (const x of source) yield x * 2
  })
  const a = Doubled()
  const b = Doubled()
  const da = collectObjects(a); const db = collectObjects(b)
  a.write(1); a.write(2); a.end()
  b.write(10); b.write(20); b.end()
  deepEq(await da, [2, 4])
  deepEq(await db, [20, 40])
}

// Regression: with low readable HWM, async-gen fan-out used to deadlock
// awaiting `drain` (a writable event that never fires here).
export async function asyncgenDownstreamBackpressure () {
  const t = objectTransform({ highWaterMark: 1 }, async function * (source) {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of source) for (let i = 0; i < 20; i++) yield i
  })
  t.write('start'); t.end()
  await new Promise((resolve) => setTimeout(resolve, 50)) // delay consumption
  const out = await collectObjects(t)
  deepEq(out, Array.from({ length: 20 }, (_, i) => i))
}

// Slow generator + many fast writes must propagate backpressure upstream
// (drain awaits) instead of growing an internal queue without bound.
export async function asyncgenWritableBackpressure () {
  const t = objectTransform({ highWaterMark: 4 }, async function * (source) {
    for await (const x of source) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      yield x
    }
  })
  let drainsAwaited = 0
  const writePromise = (async () => {
    for (let i = 0; i < 20; i++) {
      if (!t.write(i)) {
        drainsAwaited++
        await new Promise((resolve) => t.once('drain', resolve))
      }
    }
    t.end()
  })()
  const out = await collectObjects(t)
  await writePromise
  deepEq(out, Array.from({ length: 20 }, (_, i) => i))
  ok(drainsAwaited > 0, 'expected drain awaits, got 0')
}

// Mid-stream destroy must release pending awaits so the consumer loop exits.
export async function asyncgenDestroyMidStream () {
  const t = objectTransform(async function * (source) {
    for await (const x of source) { yield x; yield x }
  })
  const seen = []
  t.on('data', (d) => {
    seen.push(d)
    if (seen.length === 2) t.destroy()
  })
  t.write(1); t.write(2); t.write(3)
  await new Promise((resolve) => t.once('close', resolve))
  ok(seen.length >= 2)
}

// Destroy must finalize the user's async generator: its `finally` block
// must run so resources (file handles, subscriptions, etc.) can be released.
export async function asyncgenDestroyRunsFinally () {
  let finalized = false
  const t = objectTransform(async function * (source) {
    try {
      for await (const x of source) yield x
    } finally {
      finalized = true
    }
  })
  t.write('a')
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.destroy()
  await new Promise((resolve) => t.once('close', resolve))
  await new Promise((resolve) => setTimeout(resolve, 20)) // let finally settle
  ok(finalized, 'generator finally must run on destroy')
}
