const http = require('node:http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const Koa = require('koa');
const MongooseError = require('mongoose/lib/error');
const Router = require('@koa/router');
const auth = require('koa-basic-auth');
const koa404Handler = require('koa-404-handler');
const request = require('supertest');
const { MongoNetworkTimeoutError } = require('mongodb');
const { InterruptError } = require('redis-errors');
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

async function createApp() {
  // dynamically import get-port (ESM module)
  const { default: getPort } = await import('get-port');

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
    ctx.throw(new InterruptError('oops'));
  });

  router.get('/mongoose-error', (ctx) => {
    ctx.throw(new MongooseError('oops'));
  });

  router.get('/mongodb-error', (ctx) => {
    ctx.throw(new MongoNetworkTimeoutError('oops'));
  });

  // initialize routes on the app
  app.use(router.routes());

  // use koa-404-handler
  app.use(koa404Handler);

  const port = await getPort();
  const server = app.listen(port);

  return { server, app: request.agent(server) };
}

// check for response types
for (const type of ['text/html', 'application/json', 'text/plain']) {
  describe(`${type} responses`, () => {
    let server;
    let app;

    before(async () => {
      const result = await createApp();
      server = result.server;
      app = result.app;
    });

    after(() => {
      if (server) server.close();
    });

    for (const code of statusCodes) {
      it(`responds with ${type} for ${code} request`, async () => {
        const res = await app
          .get(`/${code}`)
          .set('Accept', type)
          .expect('Content-Type', new RegExp(type));
        assert.strictEqual(res.status, code);
      });
    }
  });
}

describe('Special cases', () => {
  let server;
  let app;

  before(async () => {
    const result = await createApp();
    server = result.server;
    app = result.app;
  });

  after(() => {
    if (server) server.close();
  });

  it("Won't throw after sending headers", async () => {
    const res = await app.get('/break-headers-sent').set('Accept', 'text/html');
    assert.strictEqual(res.text, 'foo');
    assert.strictEqual(res.status, 200);
  });

  it('Throws with WWW-Authenticate header on basic auth fail', async () => {
    const res = await app
      .get('/basic-auth')
      .expect('WWW-Authenticate', 'Basic realm="Secure Area"');
    assert.strictEqual(res.status, 401);
  });

  it('makes API friendly error messages without HTML', async () => {
    const res = await app.get('/html').set('Accept', 'application/json');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.message,
      'Hello world How are you? github.com [https://github.com]'
    );
  });

  it('throws 408 on redis error', async () => {
    const res = await app.get('/redis-error');
    assert.strictEqual(res.status, 408);
  });

  it('throws 408 on mongoose error', async () => {
    const res = await app.get('/mongoose-error');
    assert.strictEqual(res.status, 408);
  });

  it('throws 408 on mongodb error', async () => {
    const res = await app.get('/mongodb-error');
    assert.strictEqual(res.status, 408);
  });
});
