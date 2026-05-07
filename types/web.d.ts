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
export function transform(transformFn?: WebTransformFn, flushFn?: WebFlushFn): {
    readable: ReadableStream<any>;
    writable: WritableStream<any>;
};
export default transform;
export type ClassicWebTransformFn = (chunk: any, controller: TransformStreamDefaultController<any>) => void;
export type AsyncWebTransformFn = (chunk: any) => any | Promise<any>;
export type AsyncGenWebTransformFn = (source: AsyncIterable<any>) => AsyncGenerator<any, void, void>;
export type WebTransformFn = ClassicWebTransformFn | AsyncWebTransformFn | AsyncGenWebTransformFn;
export type ClassicWebFlushFn = (controller: TransformStreamDefaultController<any>) => void;
export type AsyncWebFlushFn = () => any | Promise<any>;
export type WebFlushFn = ClassicWebFlushFn | AsyncWebFlushFn;
//# sourceMappingURL=web.d.ts.map