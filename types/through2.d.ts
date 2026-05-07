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
export function transform(options?: TransformOptions | TransformFn, transformFn?: TransformFn, flushFn?: FlushFn): import("readable-stream").Transform;
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
export function objectTransform(options?: TransformOptions | TransformFn, transformFn?: TransformFn, flushFn?: FlushFn): import("readable-stream").Transform;
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
export function transformer(options?: TransformOptions | TransformFn, transformFn?: TransformFn, flushFn?: FlushFn): (override?: TransformOptions) => import("readable-stream").Transform & {
    options: TransformOptions;
};
export default through2;
export type ClassicTransformFn = (chunk: any, encoding: BufferEncoding, callback: (err?: Error | null, data?: any) => void) => void;
export type AsyncTransformFn = (chunk: any, encoding: BufferEncoding) => any | Promise<any>;
export type AsyncGenTransformFn = (source: AsyncIterable<any>) => AsyncGenerator<any, void, void>;
export type TransformFn = ClassicTransformFn | AsyncTransformFn | AsyncGenTransformFn;
export type ClassicFlushFn = (callback: (err?: Error | null) => void) => void;
export type AsyncFlushFn = () => any | Promise<any>;
export type FlushFn = ClassicFlushFn | AsyncFlushFn;
export type TransformOptions = import("readable-stream").TransformOptions;
/**
 * Default export: `transform` with legacy `.obj` / `.ctor` for v4
 * back-compatibility.
 * @type {typeof transform & { obj: typeof objectTransform, ctor: typeof transformer }}
 */
declare const through2: typeof transform & {
    obj: typeof objectTransform;
    ctor: typeof transformer;
};
//# sourceMappingURL=through2.d.ts.map