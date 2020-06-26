const through2 = require('../')
const { Buffer } = require('buffer')
const bl = require('bl')
const crypto = require('crypto')
const assert = require('assert')

function run (callback) {
  const bufs = Array.apply(null, Array(10)).map(() => crypto.randomBytes(32))
  const stream = through2((chunk, env, callback) => {
    callback(null, chunk.toString('hex'))
  })

  stream.pipe(bl((err, data) => {
    assert(!err)
    assert.strictEqual(data.toString(), Buffer.concat(bufs).toString('hex'))
    callback()
  }))

  bufs.forEach((b) => stream.write(b))
  stream.end()
}

let count = 0
const start = Date.now()

;(function exec () {
  count++
  run(() => {
    if (Date.now() - start < 1000 * 10) {
      return setImmediate(exec)
    }
    console.log('Ran', count, 'iterations in', Date.now() - start, 'ms')
  })
}())

console.log('Running for ~10s')
