const Transform = require('stream').Transform || require('readable-stream/transform')
    , inherits  = require('util').inherits

function Through2 (options, transform, flush) {
  if (!(this instanceof Through2))
    return new Through2(options, transform, flush)

  if (typeof options == 'function') {
    flush     = transform
    transform = options
    options   = {}
  }

  this._transform = transform
  if (typeof flush == 'function')
    this._flush = flush

  Transform.call(this, options)
}

inherits(Through2, Transform)

module.exports = Through2