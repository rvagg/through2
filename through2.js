import { Transform } from 'stream'

// create a new export function, used by both the main export and
// the .ctor export, contains common logic for dealing with arguments
function through2 (construct) {
  return (options, transform, flush) => {
    if (typeof options === 'function') {
      flush = transform
      transform = options
      options = {}
    }

    if (typeof transform !== 'function') {
      // noop
      transform = (chunk, enc, cb) => cb(null, chunk)
    }

    if (typeof flush !== 'function') {
      flush = null
    }

    return construct(options, transform, flush)
  }
}

// main export, just make me a transform stream!
export default through2((options, transform, flush) => {
  const t2 = new Transform(options)

  t2._transform = transform

  if (flush) {
    t2._flush = flush
  }

  return t2
})

// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call
export const ctor = through2((options, transform, flush) => {
  return class Through2 extends Transform {
    constructor (override) {
      const opts = { ...options, ...override }

      super(opts)

      this.options = opts

      this._transform = transform
      if (flush) {
        this._flush = flush
      }
    }
  }
})

export const obj = through2(function (options, transform, flush) {
  const t2 = new Transform(Object.assign({ objectMode: true, highWaterMark: 16 }, options))

  t2._transform = transform

  if (flush) {
    t2._flush = flush
  }

  return t2
})
