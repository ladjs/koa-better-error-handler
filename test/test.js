const http = require('http');

const Koa = require('koa');
const Router = require('@koa/router');
const auth = require('koa-basic-auth');
const getPort = require('get-port');
const koa404Handler = require('koa-404-handler');
const request = require('supertest');
const test = require('ava');
const { RedisError } = require('redis-errors');
const MongooseError = require('mongoose/lib/error');

const errorHandler = require('..');

const statusCodes = Object.keys(http.STATUS_CODES)
  .map((code) => {
    return Number.parseInt(code, 10);
  })
  .filter((code) => code >= 400);

// this doesn't ensure 100% code coverage, but ensures that
// the responses are sending proper Boom status messages
// and that the status codes passed through `ctx.throw(code)`
// are accurate sent in the response header's status code

test.beforeEach(async (t) => {
  // initialize our app
  const app = new Koa();

  // override koa's undocumented error handler
  app.context.onerror = errorHandler();

  // set up some routes
  const router = new Router();

  // throw an error anywhere you want!
  for (const code of statusCodes) {
    router.get(`/${code}`, (ctx) => ctx.throw(code));
  }

  router.get('/basic-auth', auth({ name: 'tj', pass: 'tobi' }), (ctx) => {
    ctx.body = 'Hello World';
  });

  router.get('/html', (ctx) => {
    ctx.api = true;
    ctx.throw(
      400,
      '<strong>Hello world</strong>\n\nHow are you?\n\n<a href="https://github.com">github.com</a>'
    );
  });

  router.get('/break-headers-sent', (ctx) => {
    ctx.type = 'text/html';
    ctx.status = 200;
    ctx.res.end('foo');
    ctx.throw(404);
  });

  router.get('/redis-error', (ctx) => {
    ctx.throw(new RedisError('oops'));
  });

  router.get('/mongoose-error', (ctx) => {
    ctx.throw(new MongooseError('oops'));
  });

  // initialize routes on the app
  app.use(router.routes());

  // use koa-404-handler
  app.use(koa404Handler);

  const port = await getPort();

  t.context.app = request.agent(app.listen(port));
});

// check for response types
for (const type of ['text/html', 'application/json', 'text/plain']) {
  for (const code of statusCodes) {
    test(`responds with ${type} for ${code} request`, async (t) => {
      const res = await t.context.app
        .get(`/${code}`)
        .set('Accept', type)
        .expect('Content-Type', new RegExp(type));
      t.is(res.status, code);
    });
  }
}

test("Won't throw after sending headers", async (t) => {
  const res = await t.context.app
    .get('/break-headers-sent')
    .set('Accept', 'text/html');
  t.is(res.text, 'foo');
  t.is(res.status, 200);
});

test('Throws with WWW-Authenticate header on basic auth fail', async (t) => {
  const res = await t.context.app
    .get('/basic-auth')
    .expect('WWW-Authenticate', 'Basic realm="Secure Area"');
  t.is(res.status, 401);
});

test('makes API friendly error messages without HTML', async (t) => {
  const res = await t.context.app
    .get('/html')
    .set('Accept', 'application/json');
  t.is(res.status, 400);
  t.is(
    res.body.message,
    'Hello world How are you? github.com [https://github.com]'
  );
});

test('throws 408 on redis error', async (t) => {
  const res = await t.context.app.get('/redis-error');
  t.is(res.status, 408);
});

test('throws 408 on mongoose error', async (t) => {
  const res = await t.context.app.get('/mongoose-error');
  t.is(res.status, 408);
});
