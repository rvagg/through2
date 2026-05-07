# through2

[![NPM](https://nodei.co/npm/through2.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/through2/)

**Tiny utilities for inserting transformation logic into Node.js streams and Web Streams pipelines.**

```bash
npm install through2
```

```js
import { transform } from 'through2'

readableStream
  .pipe(transform(async (chunk) => chunk.toString().toUpperCase()))
  .pipe(writableStream)
```

## Contents

* [Contents](#contents)
* [Why](#why)
* [Migrating from v4](#migrating-from-v4)
* [API](#api)
  * [Transform function styles](#transform-function-styles)
* [Recipes](#recipes)
  * [Map](#map)
  * [Filter](#filter)
  * [FlatMap](#flatmap)
  * [Batch](#batch)
  * [Tap](#tap)
  * [Parse newline-delimited input](#parse-newline-delimited-input)
* [Node-style streams (`from 'through2'`)](#node-style-streams-from-through2)
  * [`transform()`](#transform)
  * [`objectTransform()`](#objecttransform)
  * [`transformer()`](#transformer)
  * [Composing pipelines](#composing-pipelines)
  * [Default export (legacy)](#default-export-legacy)
* [Web Streams (`from 'through2/web'`)](#web-streams-from-through2web)
  * [`transform()` (web)](#transform-web)
  * [Implementation notes](#implementation-notes)
* [License](#license)

## Why

Writing a `Transform` stream usually means subclassing, wiring up `_transform`, choosing `objectMode`, and minding backpressure. **through2** wraps a function instead:

```js
// Without through2
import { Transform } from 'node:stream'

class Upper extends Transform {
  _transform (chunk, _enc, cb) {
    this.push(chunk.toString().toUpperCase())
    cb()
  }
}
input.pipe(new Upper()).pipe(output)

// With through2
import { transform } from 'through2'

input.pipe(transform(async (chunk) => chunk.toString().toUpperCase())).pipe(output)
```

Same idea for the modern, cross-runtime Web Streams API:

```js
import { transform } from 'through2/web'

await response.body
  .pipeThrough(transform(async (chunk) => /* ... */))
  .pipeTo(destination)
```

## Migrating from v4

v5 is a major version bump. Headline changes:

- **ESM only.** `require('through2')` no longer works. Convert callers to `import` or pin to `through2@4`.
- **Named exports added.** `transform`, `objectTransform`, `transformer` are the preferred surface in new code.
- **Default export still works.** `through2(fn)`, `through2.obj(fn)`, and `through2.ctor(fn)` produce equivalent stream instances. Once your callers are converted to ESM imports, the call-site syntax and runtime behaviour are unchanged (modulo the `instanceof` caveat below).
- **Async functions and async generators are now accepted** as transform functions, in addition to the classic `(chunk, enc, cb)` callback form. See [Transform function styles](#transform-function-styles).
- **`through2/web` subpath added** for Web Streams (`TransformStream`) pipelines.
- **`readable-stream@4`** (was `@3`) is the underlying dependency.
- **`transformer` / `.ctor` returns a factory function**, not a true constructor. The returned instance is still a `Transform`, but `instanceof YourFactory` no longer holds. Use `instanceof Transform` instead.

Mapping for legacy code:

| v4 / legacy           | v5 named export                |
| --------------------- | ------------------------------ |
| `through2(fn)`        | `transform(fn)`                |
| `through2.obj(fn)`    | `objectTransform(fn)`          |
| `through2.ctor(fn)`   | `transformer(fn)`              |

## API

Two import paths, mirroring the two stream worlds:

| Import                       | Stream API                   | Returns                | Use when                                         |
| ---------------------------- | ---------------------------- | ---------------------- | ------------------------------------------------ |
| `from 'through2'`            | Node-style streams           | `stream.Transform`     | You're working with `Readable`/`Writable`/`Transform`-shaped streams (`.pipe(...)`) |
| `from 'through2/web'`        | Web Streams (WHATWG)         | `TransformStream`      | You're working with `ReadableStream`/`WritableStream`-shaped streams (`.pipeThrough(...)`) |

The two entries differ in the *stream API* they target, not the runtime they run on. Either entry can run in Node.js, browsers, Deno, Bun, or Cloudflare Workers. Pick the one that matches the streams you're piping with.

- **`from 'through2'`** uses the Node-style streams API (`Readable`/`Writable`/`Transform`, `.pipe()`, callback-driven `_transform`). It depends on [`readable-stream`](https://github.com/nodejs/readable-stream); browser bundlers pick up that package's `browser` field automatically and ship its self-contained shim, so no Node-builtin polyfill is needed.
- **`from 'through2/web'`** uses the WHATWG Web Streams API (`TransformStream`, `.pipeThrough()`). Zero runtime dependencies; relies only on `TransformStream` being a global (it is in modern browsers, Node.js >= 18, Deno, Bun, Workers).

### Transform function styles

Every transform-creating export accepts the same three function styles, auto-dispatched by inspecting the function's kind:

```js
// 1. Classic Node-style callback (use `this.push()` and the callback)
transform(function (chunk, encoding, callback) {
  this.push(chunk)
  callback()
})

// 2. Async function (resolved value is pushed; `undefined` skips)
transform(async (chunk) => chunk.toString().toUpperCase())

// 3. Async generator (1-to-many; full pipeline coroutine)
transform(async function * (source) {
  for await (const chunk of source) {
    yield chunk
    yield chunk
  }
})
```

A flush function may be passed as the trailing argument; it follows the same dispatch rules.

> **Note on async**: the async function form does **not** use `this.push`. To emit zero or many chunks per input, use the async generator form. To emit one chunk per input (or skip), return the value (or `undefined`).

## Recipes

```js
import { objectTransform } from 'through2'
```

### Map

One in, one out. Async function form; the resolved value is pushed.

```js
objectTransform(async (item) => doSomething(item))
```

### Filter

Return `undefined` to drop a chunk.

```js
objectTransform(async (item) => predicate(item) ? item : undefined)
```

### FlatMap

One in, many out. Async generator form.

```js
objectTransform(async function * (source) {
  for await (const item of source) {
    for (const x of expand(item)) yield x
  }
})
```

### Batch

Collect a fixed-size batch, emit at size or at flush.

```js
objectTransform(async function * (source) {
  let batch = []
  for await (const item of source) {
    batch.push(item)
    if (batch.length >= 100) { yield batch; batch = [] }
  }
  if (batch.length) yield batch
})
```

### Tap

Side effect, pass through unchanged.

```js
objectTransform(async (item) => { observe(item); return item })
```

### Parse newline-delimited input

Byte chunks in, line strings out. The async generator buffers across chunk boundaries.

```js
objectTransform(async function * (source) {
  let buf = ''
  for await (const chunk of source) {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) yield line
  }
  if (buf) yield buf
})
```

For a runnable end-to-end demo combining NDJSON parsing, level filtering, formatting, and a tally, see [`example-ndjson.js`](./example-ndjson.js):

```bash
cat app.log | node example-ndjson.js warn
```

## Node-style streams (`from 'through2'`)

```js
import { transform, objectTransform, transformer } from 'through2'
```

### `transform()`

```
transform([options], transformFn[, flushFn]) -> stream.Transform
```

Returns a `stream.Transform`. `options` is forwarded to the underlying `Transform` constructor. If `transformFn` is omitted, a passthrough is returned.

```js
fs.createReadStream('in.txt')
  .pipe(transform(function (chunk, _enc, cb) {
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 97) chunk[i] = 122 // swap 'a' for 'z'
    }
    this.push(chunk)
    cb()
  }))
  .pipe(fs.createWriteStream('out.txt'))
```

### `objectTransform()`

```
objectTransform([options], transformFn[, flushFn]) -> stream.Transform
```

Like `transform`, with `objectMode: true` enabled by default. Most async/async-generator use cases want this.

### `transformer()`

```
transformer([options], transformFn[, flushFn]) -> (overrideOptions?) -> stream.Transform
```

Returns a factory function. Calling it (with or without `new`) produces a fresh `Transform` instance with the configured behaviour. Per-call options merge on top of the configured defaults; the merged options are exposed as `this.options` inside the transform function.

```js
const Counter = transformer({ objectMode: true }, function (chunk, _enc, cb) {
  this.count = (this.count || 0) + 1
  this.push(chunk)
  cb()
})

const a = Counter()
const b = new Counter({ highWaterMark: 32 })  // override per-call
```

### Composing pipelines

For anything beyond a quick demo, prefer `node:stream/promises`'s `pipeline()` over chained `.pipe()`. It propagates errors, awaits completion, and destroys all streams on failure (chained `.pipe()` silently leaves streams hanging on error).

```js
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { objectTransform } from 'through2'

await pipeline(
  createReadStream('in.ndjson'),
  objectTransform(async function * (source) {
    let buf = ''
    for await (const chunk of source) {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) yield JSON.parse(line)
    }
  }),
  objectTransform(async (record) => record.active ? record : undefined),
  objectTransform(async (record) => JSON.stringify(record) + '\n'),
  createWriteStream('out.ndjson')
)
```

`pipeline()` accepts any mix of through2-built transforms and other `Readable`/`Writable`/`Transform` instances. Use it whenever the pipeline can fail or you need to know when it's done.

A runnable, more elaborate version of this NDJSON pipeline lives in [`example-ndjson.js`](./example-ndjson.js) (parses arbitrary structured logs from stdin, filters by level, pretty-prints to stdout, summarises on stderr).

### Default export (legacy)

The default export is `transform` with `.obj` and `.ctor` attached for back-compatibility:

```js
import through2 from 'through2'

through2(fn)        // === transform(fn)
through2.obj(fn)    // === objectTransform(fn)
through2.ctor(fn)   // === transformer(fn)
```

## Web Streams (`from 'through2/web'`)

```js
import { transform } from 'through2/web'
```

### `transform()` (web)

```
transform([transformFn][, flushFn]) -> TransformStream
```

Returns a `TransformStream`. The classic-style function takes `(chunk, controller)` and uses `controller.enqueue()`. Async and async-generator forms work the same as in the Node-style streams entry.

```js
// 1-to-many fan-out (controller form, stateless)
const tagged = transform((chunk, controller) => {
  controller.enqueue({ kind: 'raw', value: chunk })
  controller.enqueue({ kind: 'upper', value: chunk.toString().toUpperCase() })
})

// Splitter: cross-chunk state is needed (a line can span chunks). The async
// generator form lets the buffer be a local variable; the classic controller
// form would need closure state plus a flush handler.
const splitter = transform(async function * (source) {
  let buf = ''
  for await (const chunk of source) {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) yield line
  }
  if (buf) yield buf
})

// Async (1-to-1) with flush
const withTrailer = transform(
  async (chunk) => chunk.toString().toUpperCase(),
  (controller) => controller.enqueue('END')
)

// Pipe a fetch response through a transform
await response.body
  .pipeThrough(transform(async (chunk) => chunk))
  .pipeTo(destinationWritableStream)
```

### Implementation notes

At the time of writing, Chromium hasn't shipped the cleanup hook that `TransformStream` would use to tear down an in-flight async generator on cancel. Without a workaround, calling `reader.cancel()` on a browser-side pipeline would leave your `async function *` suspended and its `finally` block would never run. The web entry handles this for you:

- Backpressure works in both directions through `pipeThrough`.
- Cancelling the consumer or aborting the producer cleans up your generator (its `finally` runs) and errors the other side.
- Same behaviour in browsers, Node.js, Deno, Bun, and Cloudflare Workers.

One thing to note: `transform(asyncGenFn)` returns a `{ readable, writable }` pair rather than a `TransformStream` instance. `pipeThrough` and `pipeTo` accept it identically.

## License

**through2** is Copyright (c) Rod Vagg and additional contributors and licensed under the MIT license. See the included LICENSE file for more details.
