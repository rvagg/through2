/**
 * @file Tiny utilities for inserting transformation logic into Node.js stream
 * pipelines without subclassing `Transform`. Exports `transform`,
 * `objectTransform`, `transformer`. See `through2/web` for the Web Streams
 * variant.
 */

import { Transform } from 'readable-stream'

/** @typedef {(chunk: any, encoding: BufferEncoding, callback: (err?: Error | null, data?: any) => void) => void} ClassicTransformFn */
/** @typedef {(chunk: any, encoding: BufferEncoding) => any | Promise<any>} AsyncTransformFn */
/** @typedef {(source: AsyncIterable<any>) => AsyncGenerator<any, void, void>} AsyncGenTransformFn */
/** @typedef {ClassicTransformFn | AsyncTransformFn | AsyncGenTransformFn} TransformFn */
/** @typedef {(callback: (err?: Error | null) => void) => void} ClassicFlushFn */
/** @typedef {() => any | Promise<any>} AsyncFlushFn */
/** @typedef {ClassicFlushFn | AsyncFlushFn} FlushFn */
/** @typedef {import('readable-stream').TransformOptions} TransformOptions */

const AsyncFunction = async function () {}.constructor
const AsyncGeneratorFunction = async function * () {}.constructor

/**
 * @param {Function} fn
 * @returns {'async' | 'asyncgen' | 'classic'}
 */
function fnKind (fn) {
  if (fn instanceof AsyncGeneratorFunction) return 'asyncgen'
  if (fn instanceof AsyncFunction) return 'async'
  return 'classic'
}

/**
 * @param {TransformOptions | TransformFn} [options]
 * @param {TransformFn} [transform]
 * @param {FlushFn} [flush]
 * @returns {{ options: TransformOptions, transform: TransformFn, flush: FlushFn | null }}
 */
function resolveArgs (options, transform, flush) {
  if (typeof options === 'function') {
    flush = /** @type {FlushFn} */ (transform)
    transform = options
    options = {}
  }
  if (typeof transform !== 'function') {
    /** @type {ClassicTransformFn} */
    const passthrough = (chunk, _enc, cb) => cb(null, chunk)
    transform = passthrough
  }
  return { options: options || {}, transform, flush: typeof flush === 'function' ? flush : null }
}

/**
 * @param {import('readable-stream').Transform} t
 * @param {TransformFn} transformFn
 * @param {FlushFn | null} flushFn
 */
function setupTransform (t, transformFn, flushFn) {
  const tKind = fnKind(transformFn)

  if (tKind === 'asyncgen') {
    setupAsyncGen(t, /** @type {AsyncGenTransformFn} */ (transformFn), flushFn)
    return
  }

  if (tKind === 'async') {
    const fn = /** @type {AsyncTransformFn} */ (transformFn)
    t._transform = function (chunk, enc, cb) {
      ;(async () => fn.call(this, chunk, enc))().then(
        (out) => cb(null, out),
        (err) => cb(err)
      )
    }
  } else {
    t._transform = /** @type {ClassicTransformFn} */ (transformFn)
  }

  if (flushFn) {
    if (fnKind(flushFn) === 'async') {
      const fn = /** @type {AsyncFlushFn} */ (flushFn)
      t._flush = function (cb) {
        ;(async () => fn.call(this))().then(
          (out) => { if (out !== undefined) this.push(out); cb() },
          (err) => cb(err)
        )
      }
    } else {
      t._flush = /** @type {ClassicFlushFn} */ (flushFn)
    }
  }
}

/**
 * Drive an async-generator transform. Incoming chunks are queued and exposed
 * as an async-iterable source; yielded values are pushed downstream. Honours
 * backpressure on both sides: writes pause when the queue reaches the
 * writable HWM; the consumer pauses when `t.push()` reports a full readable
 * buffer (resumed by the next `_read()` call).
 *
 * @param {import('readable-stream').Transform} t
 * @param {AsyncGenTransformFn} gen
 * @param {FlushFn | null} flushFn
 */
function setupAsyncGen (t, gen, flushFn) {
  /** @type {any[]} */
  const queue = []
  /** @type {Array<(value?: any) => void>} */
  const sourceWakeups = []
  /** @type {Array<(value?: any) => void>} */
  const writeWaiters = []
  /** @type {Array<(value?: any) => void>} */
  const readWaiters = []
  let writableEnded = false
  /** @type {{ cb: Function | null }} */
  const flushState = { cb: null }

  const writableHWM = t.writableHighWaterMark ?? 16

  const wakeOne = (/** @type {Array<(value?: any) => void>} */ arr) => {
    const w = arr.shift()
    if (w) w()
  }
  const wakeAll = (/** @type {Array<(value?: any) => void>} */ arr) => {
    while (arr.length) /** @type {(value?: any) => void} */ (arr.shift())()
  }

  const source = (async function * () {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()
        wakeOne(writeWaiters)
      }
      if (writableEnded) return
      await new Promise((resolve) => { sourceWakeups.push(resolve) })
    }
  })()

  t._transform = function (chunk, _enc, cb) {
    queue.push(chunk)
    wakeOne(sourceWakeups)
    if (queue.length >= writableHWM) writeWaiters.push(cb)
    else cb()
  }

  t._flush = function (cb) {
    flushState.cb = cb
    writableEnded = true
    wakeOne(sourceWakeups)
  }

  // Default Transform._read drives _transform pull semantics, which we
  // bypass. We use it solely as the "downstream wants more" signal.
  t._read = function () { wakeAll(readWaiters) }

  // On destroy/close, end the source iterable so the user's `for await`
  // unwinds (running its `finally`) and our consumer loop exits.
  t.once('close', () => {
    writableEnded = true
    wakeAll(sourceWakeups); wakeAll(readWaiters); wakeAll(writeWaiters)
  })

  ;(async () => {
    try {
      for await (const out of gen(source)) {
        if (t.destroyed) return
        if (!t.push(out)) {
          await new Promise((resolve) => { readWaiters.push(resolve) })
        }
      }
      if (t.destroyed) return
      if (flushFn) {
        if (fnKind(flushFn) === 'async') {
          const out = await /** @type {AsyncFlushFn} */ (flushFn).call(t)
          if (out !== undefined && !t.push(out)) {
            await new Promise((resolve) => { readWaiters.push(resolve) })
          }
        } else {
          await new Promise((resolve, reject) => {
            /** @type {ClassicFlushFn} */ (flushFn).call(t, (err) => err ? reject(err) : resolve(undefined))
          })
        }
      }
      if (flushState.cb) flushState.cb()
    } catch (err) {
      if (flushState.cb) flushState.cb(/** @type {Error} */ (err))
      else t.destroy(/** @type {Error} */ (err))
    }
  })()
}

/**
 * Build a Transform around a transformation function (classic / async / async
 * generator; auto-dispatched).
 *
 * @example Classic
 *   transform(function (chunk, _enc, cb) { this.push(chunk); cb() })
 * @example Async
 *   transform(async (chunk) => chunk.toString().toUpperCase())
 * @example Async generator (1-to-many; cross-chunk state is just a local var)
 *   transform(async function * (source) {
 *     let buf = ''
 *     for await (const chunk of source) {
 *       buf += chunk.toString()
 *       const lines = buf.split('\n')
 *       buf = lines.pop()
 *       for (const line of lines) yield line
 *     }
 *     if (buf) yield buf
 *   })
 *
 * @param {TransformOptions | TransformFn} [options]
 * @param {TransformFn} [transformFn]
 * @param {FlushFn} [flushFn]
 * @returns {import('readable-stream').Transform}
 */
export function transform (options, transformFn, flushFn) {
  const args = resolveArgs(options, transformFn, flushFn)
  const t = new Transform(args.options)
  setupTransform(t, args.transform, args.flush)
  return t
}

/**
 * Like {@link transform}, with `objectMode: true` by default.
 *
 * @example Filter
 *   objectTransform(async (item) => predicate(item) ? item : undefined)
 * @example Batch
 *   objectTransform(async function * (source) {
 *     let batch = []
 *     for await (const item of source) {
 *       batch.push(item)
 *       if (batch.length >= 100) { yield batch; batch = [] }
 *     }
 *     if (batch.length) yield batch
 *   })
 *
 * @param {TransformOptions | TransformFn} [options]
 * @param {TransformFn} [transformFn]
 * @param {FlushFn} [flushFn]
 * @returns {import('readable-stream').Transform}
 */
export function objectTransform (options, transformFn, flushFn) {
  const args = resolveArgs(options, transformFn, flushFn)
  const t = new Transform({ objectMode: true, highWaterMark: 16, ...args.options })
  setupTransform(t, args.transform, args.flush)
  return t
}

/**
 * Build a reusable factory. The returned function works with or without
 * `new`; per-call options merge over the configured defaults and are exposed
 * as `this.options` inside the transform.
 *
 * Note: in v5 this returns a Transform instance directly, not a true
 * constructor; `instanceof FactoryFn` no longer holds (`instanceof Transform`
 * still does).
 *
 * @example
 *   const Counter = transformer({ objectMode: true }, function (chunk, _enc, cb) {
 *     this.count = (this.count || 0) + 1
 *     this.push(chunk); cb()
 *   })
 *   const a = Counter()
 *   const b = new Counter({ highWaterMark: 32 })
 *
 * @param {TransformOptions | TransformFn} [options]
 * @param {TransformFn} [transformFn]
 * @param {FlushFn} [flushFn]
 * @returns {(override?: TransformOptions) => import('readable-stream').Transform & { options: TransformOptions }}
 */
export function transformer (options, transformFn, flushFn) {
  const args = resolveArgs(options, transformFn, flushFn)
  return function make (override) {
    const merged = { ...args.options, ...override }
    const t = /** @type {import('readable-stream').Transform & { options: TransformOptions }} */ (
      new Transform(merged)
    )
    t.options = merged
    setupTransform(t, args.transform, args.flush)
    return t
  }
}

/**
 * Default export: `transform` with legacy `.obj` / `.ctor` for v4
 * back-compatibility.
 * @type {typeof transform & { obj: typeof objectTransform, ctor: typeof transformer }}
 */
const through2 = /** @type {any} */ (transform)
through2.obj = objectTransform
through2.ctor = transformer

export default through2
