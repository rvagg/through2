const test = require('tape')
const through2 = require('../')
const crypto = require('crypto')
const bl = require('bl')
const spigot = require('stream-spigot')

test('plain through', (t) => {
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
    t.error(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')
    t.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})

test('pipeable through', (t) => {
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
    t.error(err)
    const s = b.toString('ascii')
    // bl() acts like a proper streams2 stream and passes as much as it's
    // asked for, so we really only get one write with such a small amount
    // of data
    t.equal(s, 'aaaaaaaaaaaaaaaaaaaaaaaaa', 'got transformed string')
    t.end()
  }))

  const bufs = bl()
  bufs.append(crypto.randomBytes(10))
  bufs.append(crypto.randomBytes(5))
  bufs.append(crypto.randomBytes(10))
  bufs.pipe(th2)
})

test('object through', (t) => {
  t.plan(3)

  const th2 = through2({ objectMode: true }, function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object through with through2.obj', (t) => {
  t.plan(3)

  const th2 = through2.obj(function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('flushing through', (t) => {
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
    t.error(err)
    const s = b.toString('ascii')
    t.equal(s, 'aaaaaaaaaabbbbbccccccccccend', 'got transformed string')
    t.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})

test('plain through ctor', (t) => {
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
    t.error(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')
    t.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})

test('reuse through ctor', (t) => {
  t.plan(6)

  const Th2 = through2.ctor(function (chunk, enc, callback) {
    if (!this._i) {
      t.ok(1, 'did not contain previous instance data (this._i)')
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
    t.error(err)
    const s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')

    const newInstance = Th2()
    newInstance.pipe(bl((err, b) => {
      t.error(err)
      const s = b.toString('ascii')
      t.equal('aaaaaaabbbbccccccc', s, 'got transformed string')
    }))

    newInstance.write(crypto.randomBytes(7))
    newInstance.write(crypto.randomBytes(4))
    newInstance.write(crypto.randomBytes(7))
    newInstance.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})

test('object through ctor', (t) => {
  t.plan(3)

  const Th2 = through2.ctor({ objectMode: true }, function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = new Th2()

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('pipeable object through ctor', (t) => {
  t.plan(4)

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
  })

  spigot({ objectMode: true }, [
    { temp: -2.2, unit: 'F' },
    { temp: -40, unit: 'F' },
    { temp: 212, unit: 'F' },
    { temp: 22, unit: 'C' }
  ]).pipe(th2)
})

test('object through ctor override', (t) => {
  t.plan(3)

  const Th2 = through2.ctor(function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ objectMode: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object settings available in transform', (t) => {
  t.plan(6)

  const Th2 = through2.ctor({ objectMode: true, peek: true }, function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2()

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object settings available in transform override', (t) => {
  t.plan(6)

  const Th2 = through2.ctor(function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ objectMode: true, peek: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('object override extends options', (t) => {
  t.plan(6)

  const Th2 = through2.ctor({ objectMode: true }, function (chunk, enc, callback) {
    t.ok(this.options.peek, 'reading options from inside _transform')
    this.push({ out: chunk.in + 1 })
    callback()
  })

  const th2 = Th2({ peek: true })

  let e = 0
  th2.on('data', (o) => {
    t.deepEqual(o, { out: e === 0 ? 102 : e === 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('ctor flush()', (t) => {
  t.plan(2)
  const th2 = through2.ctor(
    (chunk, enc, callback) => {
      t.equals(chunk.toString(), 'aa')
      callback()
    }, function fl () {
      t.ok(true)
    }
  )()

  th2.end('aa')
})

test('obj flush()', (t) => {
  t.plan(2)
  const th2 = through2.obj(
    (chunk, enc, callback) => {
      t.deepEquals(chunk, { a: 'a' })
      callback()
    }, function fl () {
      t.ok(true)
    }
  )

  th2.end({ a: 'a' })
})

test('can be destroyed', (t) => {
  t.plan(1)

  const th = through2()

  th.on('close', () => {
    t.ok(true, 'shoud emit close')
    t.end()
  })

  th.destroy()
})

test('can be destroyed twice', (t) => {
  t.plan(1)

  const th = through2()

  th.on('close', () => {
    t.ok(true, 'shoud emit close')
    t.end()
  })

  th.destroy()
  th.destroy()
})

test('noop through', (t) => {
  t.plan(2)
  const th = through2()
  th.pipe(bl((err, data) => {
    console.log('bl')
    t.error(err)
    t.equals(data.toString(), 'eeee')
  }))
  th.end('eeee')
})
