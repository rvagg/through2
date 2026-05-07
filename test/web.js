import { transform } from '../web.js'

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

const concat = (chunks) => {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let i = 0
  for (const c of chunks) { out.set(c, i); i += c.length }
  return out
}

const collect = async (readable) => {
  const reader = readable.getReader()
  const out = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) return out
    out.push(value)
  }
}

const pipeThrough = (input, ts) => {
  const r = new ReadableStream({
    start (controller) {
      for (const chunk of input) controller.enqueue(chunk)
      controller.close()
    }
  })
  return collect(r.pipeThrough(ts))
}

export async function classicControllerEnqueue () {
  const ts = transform((chunk, controller) => {
    controller.enqueue(chunk)
    controller.enqueue(chunk)
  })
  const out = await pipeThrough([encoder.encode('a'), encoder.encode('b')], ts)
  eq(decoder.decode(concat(out)), 'aabb')
}

export async function asyncReturnedValueEnqueued () {
  const ts = transform(async (chunk) => chunk % 2 === 0 ? chunk : undefined)
  const out = await pipeThrough([0, 1, 2, 3, 4], ts)
  deepEq(out, [0, 2, 4])
}

export async function asyncgenFanOut () {
  const ts = transform(async function * (source) {
    for await (const chunk of source) {
      yield chunk
      yield chunk
    }
  })
  const out = await pipeThrough(['a', 'b'], ts)
  deepEq(out, ['a', 'a', 'b', 'b'])
}

export async function asyncgenFilter () {
  const ts = transform(async function * (source) {
    for await (const chunk of source) if (chunk % 2 === 0) yield chunk
  })
  const out = await pipeThrough([0, 1, 2, 3, 4, 5], ts)
  deepEq(out, [0, 2, 4])
}

export async function flushClassic () {
  const ts = transform(
    (chunk, controller) => controller.enqueue(chunk),
    (controller) => controller.enqueue('END')
  )
  const out = await pipeThrough(['a', 'b'], ts)
  deepEq(out, ['a', 'b', 'END'])
}

export async function flushAsync () {
  const ts = transform(
    async (chunk) => chunk,
    async () => 'END'
  )
  const out = await pipeThrough(['x'], ts)
  deepEq(out, ['x', 'END'])
}

export async function asyncRejectedPropagates () {
  const ts = transform(async () => { throw new Error('boom') })
  const r = new ReadableStream({
    start (controller) { controller.enqueue('x'); controller.close() }
  })
  let err
  try { await collect(r.pipeThrough(ts)) } catch (e) { err = e }
  if (!err) throw new Error('expected error')
  eq(err.message, 'boom')
}

export async function asyncgenThrownPropagates () {
  const ts = transform(async function * () { throw new Error('gen-boom') })
  const r = new ReadableStream({
    start (controller) { controller.enqueue('x'); controller.close() }
  })
  let err
  try { await collect(r.pipeThrough(ts)) } catch (e) { err = e }
  if (!err) throw new Error('expected error')
  eq(err.message, 'gen-boom')
}

export async function noopDefault () {
  const ts = transform()
  const out = await pipeThrough(['a', 'b', 'c'], ts)
  deepEq(out, ['a', 'b', 'c'])
}

// Memory backpressure: a slow async generator with many fast upstream chunks
// must not let the internal queue grow unbounded. The transform method holds
// when its queue is full, propagating backpressure through pipeThrough.
export async function asyncgenWritableBackpressure () {
  const ts = transform(async function * (source) {
    for await (const x of source) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      yield x
    }
  })
  const N = 200
  const r = new ReadableStream({
    start (controller) {
      for (let i = 0; i < N; i++) controller.enqueue(i)
      controller.close()
    }
  })
  const out = await collect(r.pipeThrough(ts))
  deepEq(out, Array.from({ length: N }, (_, i) => i))
}

// Reader cancel must finalize the user's async generator: its `finally`
// block must run so resources can be released.
export async function asyncgenCancelRunsFinally () {
  let finalized = false
  const ts = transform(async function * (source) {
    try {
      for await (const x of source) yield x
    } finally {
      finalized = true
    }
  })
  const r = new ReadableStream({
    start (controller) { controller.enqueue('a') }
    // intentionally never closes; reader will cancel
  })
  const out = r.pipeThrough(ts)
  const reader = out.getReader()
  await reader.read()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await reader.cancel()
  await new Promise((resolve) => setTimeout(resolve, 20))
  if (!finalized) throw new Error('generator finally must run on cancel')
}

// Downstream backpressure: a fast generator emitting many chunks, with a
// slow reader, must not flood the readable buffer unboundedly.
export async function asyncgenReaderBackpressure () {
  const ts = transform(async function * (source) {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of source) for (let i = 0; i < 50; i++) yield i
  })
  const r = new ReadableStream({
    start (controller) { controller.enqueue('go'); controller.close() }
  })
  const reader = r.pipeThrough(ts).getReader()
  const out = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value)
    await new Promise((resolve) => setTimeout(resolve, 1)) // slow reader
  }
  deepEq(out, Array.from({ length: 50 }, (_, i) => i))
}
