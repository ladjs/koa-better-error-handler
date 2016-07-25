
import errorHandler from '../../lib';
import Router from 'koa-router';
import request from 'supertest';
import _ from 'lodash';
import Koa from 'koa';
import http from 'http';

const statusCodes = _.keys(http.STATUS_CODES).map(code => {
  return parseInt(code, 10);
}).filter(code => code >= 400);

// this doesn't ensure 100% code coverage, but ensures that
// the responses are sending proper Boom status messages
// and that the status codes passed through `ctx.throw(code)`
// are accurate sent in the response header's status code

describe('koa-better-error-handler', function () {

  let app;
  let router;

  beforeEach(function () {

    // initialize our app
    app = new Koa();

    // override koa's undocumented error handler
    app.context.onerror = errorHandler;

    // set up some routes
    router = new Router();

    // throw an error anywhere you want!
    _.each(statusCodes, function (code) {
      router.get(`/${code}`, ctx => ctx.throw(code));
    });

    // custom 404 handler since it's not already built in
    app.use(async (ctx, next) => {
      try {
        await next();
        if (ctx.status === 404)
          ctx.throw(404);
      } catch (err) {
        ctx.throw(err);
        ctx.app.emit('error', err, ctx);
      }
    });

    // initialize routes on the app
    app.use(router.routes());

  });

  // check for response types
  _.each([ 'text/html', 'application/json', 'text/plain' ], function (type) {
    _.each(statusCodes, function (code) {
      it(`responds with ${type} for ${code} request`, function (done) {
        request(app.listen())
          .get(`/${code}`)
          .set('Accept', type)
          .expect(code)
          .expect('Content-Type', new RegExp(type))
          .end(done);
      });
    });
  });

});
