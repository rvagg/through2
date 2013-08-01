const test     = require('tape')
    , through2 = require('./')
    , crypto   = require('crypto')
    , bl       = require('bl')

test('plain through', function (t) {
  var th2 = through2(function (chunk, enc, callback) {
    if (!this._i)
      this._i = 97 // 'a'
    else
      this._i++
    var b = new Buffer(chunk.length)
    for (var i = 0; i < chunk.length; i++)
      b[i] = this._i
    this.push(b)
    callback()
  })

  th2.pipe(bl(function (err, b) {
    var s = b.toString('ascii')
    t.equal('aaaaaaaaaabbbbbcccccccccc', s, 'got transformed string')
    t.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})

test('pipeable through', function (t) {
  var th2 = through2(function (chunk, enc, callback) {
    if (!this._i)
      this._i = 97 // 'a'
    else
      this._i++
    var b = new Buffer(chunk.length)
    for (var i = 0; i < chunk.length; i++)
      b[i] = this._i
    this.push(b)
    callback()
  })

  th2.pipe(bl(function (err, b) {
    var s = b.toString('ascii')
    // bl() acts like a proper streams2 stream and passes as much as it's
    // asked for, so we really only get one write with such a small amount
    // of data
    t.equal(s, 'aaaaaaaaaaaaaaaaaaaaaaaaa', 'got transformed string')
    t.end()
  }))

  var bufs = bl()
  bufs.append(crypto.randomBytes(10))
  bufs.append(crypto.randomBytes(5))
  bufs.append(crypto.randomBytes(10))
  bufs.pipe(th2)
})

test('object through', function (t) {
  t.plan(3)

  var th2 = through2({ objectMode: true}, function (chunk, enc, callback) {
    this.push({ out: chunk.in + 1 })
    callback()
  })

  var e = 0
  th2.on('data', function (o) {
    t.deepEqual(o, { out: e === 0 ? 102 : e == 1 ? 203 : -99 }, 'got transformed object')
    e++
  })

  th2.write({ in: 101 })
  th2.write({ in: 202 })
  th2.write({ in: -100 })
  th2.end()
})

test('flushing through', function (t) {
  var th2 = through2(function (chunk, enc, callback) {
    if (!this._i)
      this._i = 97 // 'a'
    else
      this._i++
    var b = new Buffer(chunk.length)
    for (var i = 0; i < chunk.length; i++)
      b[i] = this._i
    this.push(b)
    callback()
  }, function (callback) {
    this.push(new Buffer([ 101, 110, 100 ]))
    callback()
  })

  th2.pipe(bl(function (err, b) {
    var s = b.toString('ascii')
    t.equal(s, 'aaaaaaaaaabbbbbccccccccccend', 'got transformed string')
    t.end()
  }))

  th2.write(crypto.randomBytes(10))
  th2.write(crypto.randomBytes(5))
  th2.write(crypto.randomBytes(10))
  th2.end()
})