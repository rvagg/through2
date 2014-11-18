var Transform = require('readable-stream/transform')
  , inherits  = require('util').inherits
  , xtend     = require('xtend')

var debug = process.env['DEBUG'] || ''
var DEBUG = (debug === '*') || (debug === 'through2')

function DestroyableTransform(opts) {
  Transform.call(this, opts)
  this._destroyed = false
  if (DEBUG) {
    this.on('finish', function() {
      console.error('  through2 finish')
    })
    this.on('end', function() {
      console.error('  through2 end')
    })
  }
}

inherits(DestroyableTransform, Transform)

DestroyableTransform.prototype.destroy = function(err) {
  if (this._destroyed) return
  this._destroyed = true
  
  var self = this
  process.nextTick(function() {
    if (err)
      self.emit('error', err)
    self.emit('close')
  })
}

// a noop _transform function
function noop (chunk, enc, callback) {
  callback(null, chunk)
}


// create a new export function, used by both the main export and
// the .ctor export, contains common logic for dealing with arguments
function through2 (construct) {
  return function (options, transform, flush) {
    if (typeof options == 'function') {
      flush     = transform
      transform = options
      options   = {}
    }

    if (typeof transform != 'function')
      transform = noop

    if (typeof flush != 'function')
      flush = null

    return construct(options, transform, flush)
  }
}


// main export, just make me a transform stream!
module.exports = through2(function (options, transform, flush) {
  if (DEBUG) console.error('  through2 initialize')
  
  var t2 = new DestroyableTransform(options)

  if (DEBUG) transform = debugTransform(transform, t2)
  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})


// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call
module.exports.ctor = through2(function (options, transform, flush) {
  if (DEBUG) console.error('  through2.ctor initialize')
  
  function Through2 (override) {
    if (!(this instanceof Through2))
      return new Through2(override)

    this.options = xtend(options, override)

    DestroyableTransform.call(this, this.options)
  }

  inherits(Through2, DestroyableTransform)

  if (DEBUG) transform = debugTransform(transform)
  Through2.prototype._transform = transform

  if (flush)
    Through2.prototype._flush = flush

  return Through2
})


module.exports.obj = through2(function (options, transform, flush) {
  if (DEBUG) console.error('  through2.obj initialize')
  
  var t2 = new DestroyableTransform(xtend({ objectMode: true, highWaterMark: 16 }, options))

  if (DEBUG) transform = debugTransform(transform, t2)
  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
})

function debugTransform(transform, ctx) {
  return function debugTransform(chunk, enc, callback) {
    console.error('  through2 transform', typeof chunk, {length: chunk.length, encoding: enc})
    transform.apply(ctx || this, arguments)
  }
}