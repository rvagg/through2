require('./basic-test')

if (process.env.SAUCE_KEY && process.env.SAUCE_USER && /v0\.10/.test(process.version))
  require('./sauce.js')