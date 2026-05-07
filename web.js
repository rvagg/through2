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
 * @returns {TransformStream<any, any>}
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
 * Drive an async-generator TransformStream with backpressure on both sides:
 * `transform()` holds when the internal queue is full (propagates upstream);
 * the consumer yields to the macrotask queue when `controller.desiredSize`
 * goes negative (waits for downstream reads).
 *
 * @param {AsyncGenWebTransformFn} gen
 * @param {WebFlushFn} [flushFn]
 * @returns {TransformStream<any, any>}
 */
function asyncGenTransform (gen, flushFn) {
  /** @type {any[]} */
  const queue = []
  /** @type {Array<(value?: any) => void>} */
  const sourceWakeups = []
  /** @type {Array<(value?: any) => void>} */
  const writeWaiters = []
  let writableEnded = false

  const QUEUE_HWM = 16

  const wakeOne = (/** @type {Array<(value?: any) => void>} */ arr) => {
    const w = arr.shift()
    if (w) w()
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

  /** @type {Promise<void> | null} */
  let consumerDone = null

  return new TransformStream({
    start (controller) {
      consumerDone = (async () => {
        try {
          for await (const out of gen(source)) {
            controller.enqueue(out)
            // setTimeout(0), not queueMicrotask: macrotask yield lets the
            // reader's I/O / setTimeout callbacks run between checks.
            while (controller.desiredSize !== null && controller.desiredSize < 0) {
              await new Promise((resolve) => setTimeout(resolve, 0))
            }
          }
          if (flushFn) {
            if (fnKind(flushFn) === 'async') {
              const out = await /** @type {AsyncWebFlushFn} */ (flushFn)()
              if (out !== undefined) controller.enqueue(out)
            } else {
              /** @type {ClassicWebFlushFn} */ (flushFn)(controller)
            }
          }
        } catch (err) {
          controller.error(err)
        }
      })()
    },
    async transform (chunk) {
      queue.push(chunk)
      wakeOne(sourceWakeups)
      if (queue.length >= QUEUE_HWM) {
        await new Promise((resolve) => { writeWaiters.push(resolve) })
      }
    },
    async flush () {
      writableEnded = true
      wakeOne(sourceWakeups)
      if (consumerDone) await consumerDone
    },
    // Called when the readable side is cancelled or the writable side is
    // aborted. End the source iterable so the user's `for await` unwinds
    // (running its `finally`) instead of staying suspended forever.
    cancel () {
      writableEnded = true
      wakeOne(sourceWakeups)
      // Release any backpressured writes so they don't leak.
      while (writeWaiters.length) /** @type {() => void} */ (writeWaiters.shift())()
    }
  })
}

export default transform
