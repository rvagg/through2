/* eslint-env mocha */

const test = it
const { assert: t } = require('chai')
const through2 = require('../')
const { Buffer } = require('buffer')
const bl = require('bl')
const spigot = require('stream-spigot')

function randomBytes (len) {
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = Math.floor(Math.random() * 0xff)
  }
  return bytes
}

test('plain through', (done) => {
  const th2 = through2(function (chunk, enc, callback) {
    if (!this._i) {
      this._i = 97
    } else { // 'a'
      this._i++
    }
    const b = Buffer.alloc(chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      b[i] = this._i
    }
    this.push(b)
    callback()
  })

  th2.pipe(bl((err, b) => {
    t.ifError(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')
    done()
  }))

  th2.write(randomBytes(10))
  th2.write(randomBytes(5))
  th2.write(randomBytes(10))
  th2.end()
})

test('pipeable through', (done) => {
  const th2 = through2(function (chunk, enc, callback) {
    if (!this._i) {
      this._i = 97
    } else { // 'a'
      this._i++
    }
    const b = Buffer.alloc(chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      b[i] = this._i
    }
    this.push(b)
    callback()
  })

  th2.pipe(bl((err, b) => {
    t.ifError(err)
    const s = b.toString('ascii')
    // bl() acts like a proper streams2 stream and passes as much as it's
    // asked for, so we really only get one write with such a small amount
    // of data
    t.equal(s, 'aaaaaaaaaaaaaaaaaaaaaaaaa', 'got transformed string')
    done()
  }))

  const bufs = bl()
  bufs.append(randomBytes(10))
  bufs.append(randomBytes(5))
  bufs.append(randomBytes(10))
  bufs.pipe(th2)
})

test('object through', (done) => {
  const th2 = through2({ objectMode: true }, function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object through with through2.obj', (done) => {
  const th2 = through2.obj(function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('flushing through', (done) => {
  const th2 = through2(function (chunk, enc, callback) {
    if (!this._i) {
      this._i = 97
    } else { // 'a'
      this._i++
    }
    const b = Buffer.alloc(chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      b[i] = this._i
    }
    this.push(b)
    callback()
  }, function (callback) {
    this.push(Buffer.from([101, 110, 100]))
    callback()
  })

  th2.pipe(bl((err, b) => {
    t.ifError(err)
    const s = b.toString('ascii')
    t.equal(s, 'aaaaaaaaaabbbbbccccccccccend', 'got transformed string')
    done()
  }))

  th2.write(randomBytes(10))
  th2.write(randomBytes(5))
  th2.write(randomBytes(10))
  th2.end()
})

test('plain through ctor', (done) => {
  const Th2 = through2.ctor(function (chunk, enc, callback) {
    if (!this._i) {
      this._i = 97 // 'a'
    } else {
      this._i++
    }
    const b = Buffer.alloc(chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      b[i] = this._i
    }
    this.push(b)
    callback()
  })

  const th2 = new Th2()

  th2.pipe(bl((err, b) => {
    t.ifError(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')
    done()
  }))

  th2.write(randomBytes(10))
  th2.write(randomBytes(5))
  th2.write(randomBytes(10))
  th2.end()
})

test('reuse through ctor', (done) => {
  let uses = 0
  const Th2 = through2.ctor(function (chunk, enc, callback) {
    if (!this._i) {
      uses++
      this._i = 97 // 'a'
    } else {
      this._i++
    }
    const b = Buffer.alloc(chunk.length)
    for (let i = 0; i < chunk.length; i++) {
      b[i] = this._i
    }
    this.push(b)
    callback()
  })

  const th2 = Th2()

  th2.pipe(bl((err, b) => {
    t.ifError(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')

    const newInstance = Th2()
    newInstance.pipe(bl((err, b) => {
      t.ifError(err)
      const s = b.toString('ascii')
      t.equal('aaaaaaabbbbccccccc', s, 'got transformed string')
      t.equal(uses, 2)
      done()
    }))

    newInstance.write(randomBytes(7))
    newInstance.write(randomBytes(4))
    newInstance.write(randomBytes(7))
    newInstance.end()
  }))

  th2.write(randomBytes(10))
  th2.write(randomBytes(5))
  th2.write(randomBytes(10))
  th2.end()
})

test('object through ctor', (done) => {
  const Th2 = through2.ctor({ objectMode: true }, function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = new Th2()

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('pipeable object through ctor', (done) => {
  const Th2 = through2.ctor({ objectMode: true }, function (record, enc, callback) {
    if (record.temp != null && record.unit === 'F') {
      record.temp = ((record.temp - 32) * 5) / 9
      record.unit = 'C'
    }
    this.push(record)
    callback()
  })

  const th2 = Th2()

  const expect = [-19, -40, 100, 22]
  th2.on('data', (o) => {
    t.deepEqual(o, { temp: expect.shift(), unit: 'C' }, 'got transformed object')
    if (!expect.length) {
      done()
    }
  })

  spigot({ objectMode: true }, [
    { temp: -2.2, unit: 'F' },
    { temp: -40, unit: 'F' },
    { temp: 212, unit: 'F' },
    { temp: 22, unit: 'C' }
  ]).pipe(th2)
})

test('object through ctor override', (done) => {
  const Th2 = through2.ctor(function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ objectMode: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object settings available in transform', (done) => {
  const Th2 = through2.ctor({ objectMode: true, peek: true }, function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2()

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object settings available in transform override', (done) => {
  const Th2 = through2.ctor(function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ objectMode: true, peek: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object override extends options', (done) => {
  const Th2 = through2.ctor({ objectMode: true }, function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ peek: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    if (++e === 3) {
      done()
    }
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('ctor flush()', (done) => {
  let chunkCalled = false
  const th2 = through2.ctor(
    (chunk, enc, callback) => {
      t.equal(chunk.toString(), 'aa')
      chunkCalled = true
      callback()
    }, function fl () {
      t(chunkCalled)
      done()
    }
  )()

  th2.end('aa')
})

test('obj flush()', (done) => {
  let chunkCalled = false
  const th2 = through2.obj(
    (chunk, enc, callback) => {
      t.deepEqual(chunk, { a: 'a' })
      chunkCalled = true
      callback()
    }, function fl () {
      t(chunkCalled)
      done()
    }
  )

  th2.end({ a: 'a' })
})

test('can be destroyed', (done) => {
  const th = through2()

  th.on('close', () => {
    t.ok(true, 'shoud emit close')
    done()
  })

  th.destroy()
})

test('can be destroyed twice', (done) => {
  const th = through2()

  th.on('close', () => {
    t.ok(true, 'shoud emit close')
    done()
  })

  th.destroy()
  th.destroy()
})

test('noop through', (done) => {
  const th = through2()
  th.pipe(bl((err, data) => {
    t.ifError(err)
    t.equal(data.toString(), 'eeee')
    done()
  }))
  th.end('eeee')
})
