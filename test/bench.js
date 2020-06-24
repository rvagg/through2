/*
on rvagg@fletcher:
  @0.2.3: Ran 36719 iterations in 10000 ms
*/

const through2 = require('../')
const bl = require('bl')
const crypto = require('crypto')
const assert = require('assert')

function run (callback) {
  var bufs = Array.apply(null, Array(10)).map(function () { return crypto.randomBytes(32) })
  var stream = through2(function (chunk, env, callback) {
    callback(null, chunk.toString('hex'))
  })

  stream.pipe(bl(function (err, data) {
    assert(!err)
    assert.strictEqual(data.toString(), Buffer.concat(bufs).toString('hex'))
    callback()
  }))

  bufs.forEach(function (b) {
    stream.write(b)
  })
  stream.end()
}

var count = 0
var start = Date.now()

;(function exec () {
  count++
  run(function () {
    if (Date.now() - start < 1000 * 10) {
      return setImmediate(exec)
    }
    console.log('Ran', count, 'iterations in', Date.now() - start, 'ms')
  })
}())

console.log('Running for ~10s')
