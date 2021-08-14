import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import assert, { strictEqual } from 'node:assert'
import bl from 'bl'
import through2 from '../through2.js'

function run (callback) {
  const bufs = Array.apply(null, Array(10)).map(() => randomBytes(32))
  const stream = through2((chunk, env, callback) => {
    callback(null, chunk.toString('hex'))
  })

  stream.pipe(bl((err, data) => {
    assert(!err)
    strictEqual(data.toString(), Buffer.concat(bufs).toString('hex'))
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
