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
 * Drive an async-generator transform as a `{ readable, writable }` pair.
 *
 * The pair shape (rather than a `TransformStream`) is required because we
 * need cancellation hooks: the `Transformer.cancel` callback is in the
 * WHATWG Streams spec but not yet implemented in major browsers as of 2026,
 * whereas `ReadableStream.cancel` and `WritableStream.abort` are universally
 * available. The pair satisfies `pipeThrough`'s structural contract.
 *
 * Backpressure follows the standard pull-based model: `pull()` enqueues one
 * yielded value per call and is invoked by the runtime exactly when the
 * readable buffer has room; `write()` returns a pending promise when the
 * internal queue is full, propagating pressure upstream.
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
  let flushed = false

  const QUEUE_HWM = 16

  const wakeOne = (/** @type {Array<(value?: any) => void>} */ arr) => {
    const w = arr.shift()
    if (w) w()
  }
  const wakeAll = (/** @type {Array<(value?: any) => void>} */ arr) => {
    while (arr.length) /** @type {(value?: any) => void} */ (arr.shift())()
  }

  // The source iterable user code consumes via `for await (const x of source)`.
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

  // Build the user's iterator once; pull() drives it on demand.
  const iter = gen(source)

  // Controllers captured in start() so the two sides can cross-propagate
  // termination (matching the WHATWG TransformStream behaviour: cancel on
  // one side errors the other).
  /** @type {ReadableStreamDefaultController<any> | null} */
  let readableController = null
  /** @type {WritableStreamDefaultController | null} */
  let writableController = null
  let terminating = false

  // Shared cleanup: end the source, finalize the user's generator (running
  // its `finally`), error the opposite side. Idempotent.
  const finalize = async (/** @type {any} */ reason, /** @type {'readable'|'writable'} */ origin) => {
    if (terminating) return
    terminating = true
    sourceEnded = true
    wakeAll(sourceWakeups)
    wakeAll(writeWaiters)
    if (typeof iter.return === 'function') {
      try { await iter.return() } catch { /* user finally threw; ignored */ }
    }
    if (origin === 'readable' && writableController) {
      try { writableController.error(reason) } catch { /* already errored */ }
    } else if (origin === 'writable' && readableController) {
      try { readableController.error(reason) } catch { /* already errored */ }
    }
  }

  return {
    readable: new ReadableStream({
      start (controller) { readableController = controller },
      async pull (controller) {
        try {
          const { value, done } = await iter.next()
          if (!done) {
            controller.enqueue(value)
            return
          }
          if (!flushed) {
            flushed = true
            if (flushFn) {
              if (fnKind(flushFn) === 'async') {
                const fn = /** @type {AsyncWebFlushFn} */ (flushFn)
                const out = await fn()
                if (out !== undefined) controller.enqueue(out)
              } else {
                // Classic flush expects a TransformStreamDefaultController-ish
                // shape; synthesize one over the ReadableStream's controller.
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
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
      cancel (reason) { return finalize(reason, 'readable') }
    }),
    writable: new WritableStream({
      start (controller) { writableController = controller },
      write (chunk) {
        queue.push(chunk)
        wakeOne(sourceWakeups)
        if (queue.length >= QUEUE_HWM) {
          return new Promise((resolve) => { writeWaiters.push(resolve) })
        }
        return undefined
      },
      close () {
        // Clean end: let the source iterable return so the user's `for await`
        // exits normally and pull() can run any flush logic.
        sourceEnded = true
        wakeAll(sourceWakeups)
      },
      abort (reason) { return finalize(reason, 'writable') }
    })
  }
}

export default transform
