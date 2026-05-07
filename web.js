/**
 * @file Tiny utility for inserting transformation logic into Web Streams
 * pipelines. Returns `TransformStream` instances; zero runtime dependencies;
 * runs anywhere `TransformStream` is a global (modern browsers, Node.js,
 * Deno, Bun, Cloudflare Workers). See the root `through2` entry for the
 * Node.js streams variant.
 */

/** @typedef {(chunk: any, controller: TransformStreamDefaultController<any>) => void} ClassicWebTransformFn */
/** @typedef {(chunk: any) => any | Promise<any>} AsyncWebTransformFn */
/** @typedef {(source: AsyncIterable<any>) => AsyncGenerator<any, void, void>} AsyncGenWebTransformFn */
/** @typedef {ClassicWebTransformFn | AsyncWebTransformFn | AsyncGenWebTransformFn} WebTransformFn */
/** @typedef {(controller: TransformStreamDefaultController<any>) => void} ClassicWebFlushFn */
/** @typedef {() => any | Promise<any>} AsyncWebFlushFn */
/** @typedef {ClassicWebFlushFn | AsyncWebFlushFn} WebFlushFn */

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
 * Build a TransformStream around a transformation function (classic /
 * async / async generator; auto-dispatched).
 *
 * @example Classic controller form (multiple enqueue per chunk)
 *   transform((chunk, controller) => {
 *     controller.enqueue(chunk)
 *     controller.enqueue({ size: chunk.length })
 *   })
 * @example Async (returned value enqueued)
 *   transform(async (chunk) => chunk.toString().toUpperCase())
 * @example Async generator (cross-chunk state is just a local var)
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
 * @example Pipe a fetch response
 *   await response.body.pipeThrough(transform(async (chunk) => chunk)).pipeTo(dest)
 *
 * @param {WebTransformFn} [transformFn]
 * @param {WebFlushFn} [flushFn]
 * @returns {{ readable: ReadableStream<any>, writable: WritableStream<any> }}
 */
export function transform (transformFn, flushFn) {
  if (typeof transformFn !== 'function') {
    /** @type {ClassicWebTransformFn} */
    const passthrough = (chunk, controller) => controller.enqueue(chunk)
    transformFn = passthrough
  }

  const tKind = fnKind(transformFn)

  if (tKind === 'asyncgen') {
    return asyncGenTransform(/** @type {AsyncGenWebTransformFn} */ (transformFn), flushFn)
  }

  /** @type {Transformer<any, any>} */
  const inner = {}

  if (tKind === 'async') {
    const fn = /** @type {AsyncWebTransformFn} */ (transformFn)
    inner.transform = async (chunk, controller) => {
      const out = await fn(chunk)
      if (out !== undefined) controller.enqueue(out)
    }
  } else {
    const fn = /** @type {ClassicWebTransformFn} */ (transformFn)
    inner.transform = (chunk, controller) => fn(chunk, controller)
  }

  if (flushFn) {
    if (fnKind(flushFn) === 'async') {
      const fn = /** @type {AsyncWebFlushFn} */ (flushFn)
      inner.flush = async (controller) => {
        const out = await fn()
        if (out !== undefined) controller.enqueue(out)
      }
    } else {
      const fn = /** @type {ClassicWebFlushFn} */ (flushFn)
      inner.flush = (controller) => fn(controller)
    }
  }

  return new TransformStream(inner)
}

/**
 * Drive an async-generator transform with backpressure on both sides.
 *
 * Returns a `{ readable, writable }` pair (the structural shape `pipeThrough`
 * accepts) rather than a `TransformStream`, because we need to react to
 * `reader.cancel()` / `writer.abort()`. The Transformer `cancel` hook on
 * `TransformStream` is in the WHATWG spec but not yet implemented in major
 * browsers (as of 2026); `ReadableStream`'s `cancel` and `WritableStream`'s
 * `abort` hooks are universally available, so we use those instead.
 *
 * Backpressure: writes pause when the internal queue reaches the HWM
 * (returning a pending promise from `write()` propagates pressure upstream);
 * the consumer yields to the macrotask queue when `controller.desiredSize`
 * goes negative.
 *
 * @param {AsyncGenWebTransformFn} gen
 * @param {WebFlushFn} [flushFn]
 * @returns {{ readable: ReadableStream<any>, writable: WritableStream<any> }}
 */
function asyncGenTransform (gen, flushFn) {
  /** @type {any[]} */
  const queue = []
  /** @type {Array<(value?: any) => void>} */
  const sourceWakeups = []
  /** @type {Array<(value?: any) => void>} */
  const writeWaiters = []
  let sourceEnded = false

  const QUEUE_HWM = 16

  const wakeOne = (/** @type {Array<(value?: any) => void>} */ arr) => {
    const w = arr.shift()
    if (w) w()
  }
  const wakeAll = (/** @type {Array<(value?: any) => void>} */ arr) => {
    while (arr.length) /** @type {(value?: any) => void} */ (arr.shift())()
  }

  // End the source iterable cleanly. Used by close, abort, and cancel paths
  // so the user's `for await` unwinds and its `finally` runs.
  const endSource = () => {
    sourceEnded = true
    wakeAll(sourceWakeups)
    wakeAll(writeWaiters)
  }

  const source = (async function * () {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()
        wakeOne(writeWaiters)
      }
      if (sourceEnded) return
      await new Promise((resolve) => { sourceWakeups.push(resolve) })
    }
  })()

  /** @type {Promise<void> | null} */
  let consumerDone = null

  const readable = new ReadableStream({
    start (controller) {
      consumerDone = (async () => {
        try {
          for await (const out of gen(source)) {
            controller.enqueue(out)
            while (controller.desiredSize !== null && controller.desiredSize < 0) {
              await new Promise((resolve) => setTimeout(resolve, 0))
            }
          }
          if (flushFn) {
            if (fnKind(flushFn) === 'async') {
              const fn = /** @type {AsyncWebFlushFn} */ (flushFn)
              const out = await fn()
              if (out !== undefined) controller.enqueue(out)
            } else {
              // Classic flush expects a TransformStreamDefaultController; we
              // have a ReadableStream's controller. Synthesize a compatible
              // shape (enqueue / error / terminate).
              /** @type {any} */
              const proxy = {
                enqueue: (/** @type {any} */ c) => controller.enqueue(c),
                error: (/** @type {any} */ e) => controller.error(e),
                terminate: () => controller.close()
              }
              const fn = /** @type {ClassicWebFlushFn} */ (flushFn)
              fn(proxy)
            }
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      })()
    },
    cancel () { endSource() }
  })

  const writable = new WritableStream({
    write (chunk) {
      queue.push(chunk)
      wakeOne(sourceWakeups)
      if (queue.length >= QUEUE_HWM) {
        return new Promise((resolve) => { writeWaiters.push(resolve) })
      }
      return undefined
    },
    async close () {
      endSource()
      if (consumerDone) await consumerDone
    },
    abort () { endSource() }
  })

  return { readable, writable }
}

export default transform
