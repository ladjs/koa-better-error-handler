const http = require('http');
const test = require('ava');
const Router = require('@koa/router');
const request = require('supertest');
const Koa = require('koa');
const _ = require('lodash');
const koa404Handler = require('koa-404-handler');
const auth = require('koa-basic-auth');

const errorHandler = require('..');

const statusCodes = _.keys(http.STATUS_CODES)
  .map(code => {
    return parseInt(code, 10);
  })
  .filter(code => code >= 400);

// this doesn't ensure 100% code coverage, but ensures that
// the responses are sending proper Boom status messages
// and that the status codes passed through `ctx.throw(code)`
// are accurate sent in the response header's status code

test.beforeEach(t => {
  // initialize our app
  t.context.app = new Koa();

  // override koa's undocumented error handler
  t.context.app.context.onerror = errorHandler;

  // set up some routes
  const router = new Router();

  // throw an error anywhere you want!
  _.each(statusCodes, code => {
    router.get(`/${code}`, ctx => ctx.throw(code));
  });

  router.get('/basic-auth', auth({ name: 'tj', pass: 'tobi' }), ctx => {
    ctx.body = 'Hello World';
  });

  router.get('/break-headers-sent', ctx => {
    ctx.type = 'text/html';
    ctx.body = 'foo';
    ctx.res.end();
    ctx.throw(404);
  });

  // initialize routes on the app
  t.context.app.use(router.routes());

  // use koa-404-handler
  t.context.app.use(koa404Handler);
});

// check for response types
_.each(['text/html', 'application/json', 'text/plain'], type => {
  _.each(statusCodes, code => {
    test.cb(`responds with ${type} for ${code} request`, t => {
      request(t.context.app.listen())
        .get(`/${code}`)
        .set('Accept', type)
        .expect(code)
        .expect('Content-Type', new RegExp(type))
        .end(t.end);
    });
  });
});

test.cb("Won't throw after sending headers", t => {
  request(t.context.app.listen())
    .get('/break-headers-sent')
    .set('Accept', 'text/html')
    .expect(200)
    .end(t.end);
});

test.cb('Throws with WWW-Authenticate header on basic auth fail', t => {
  request(t.context.app.listen())
    .get('/basic-auth')
    .expect('WWW-Authenticate', 'Basic realm="Secure Area"')
    .expect(401)
    .end(t.end);
});
