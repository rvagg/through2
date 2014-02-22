var Transform = require('readable-stream/transform')
  , inherits  = require('util').inherits
  , xtend     = require('xtend')


// a noop _transform function
function noop (chunk, enc, callback) {
  callback(null, chunk)
}


// create a new export function, contains common logic for dealing with arguments
function through2 (construct, objectMode) {
  return function (options, transform, flush) {
    if (typeof options == 'function') {
      flush     = transform
      transform = options
      options   = {}
    }

    if (objectMode)
      options.objectMode = true

    if (typeof transform != 'function')
      transform = noop

    if (options.objectMode && transform.length === 2)
      transform = convertToThreeArg(transform)

    if (typeof flush != 'function')
      flush = null

    return construct(options, transform, flush)
  }
}

// converts a 2-arg transform into the 3-arg form by ignoring `enc`
// this only makes sense for objectMode streams!
function convertToThreeArg (transform) {
  return function (obj, enc, next) {
    return transform(obj, next)
  }
}

function makeTransform (options, transform, flush) {
  var t2 = new Transform(options)

  t2._transform = transform

  if (flush)
    t2._flush = flush

  return t2
}

// main export, just make me a transform stream!
module.exports = through2(makeTransform)

// make me an objectMode transform stream
module.exports.obj = through2(makeTransform, true)

// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call
module.exports.ctor = through2(function (options, transform, flush) {
  function Through2 (override) {
    if (!(this instanceof Through2))
      return new Through2(override)

    this.options = xtend(options, override)

    Transform.call(this, this.options)
  }

  inherits(Through2, Transform)

  Through2.prototype._transform = transform

  if (flush)
    Through2.prototype._flush = flush

  return Through2
})
