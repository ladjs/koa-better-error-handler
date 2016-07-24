
import errorHandler from '../';
import Koa from 'koa';
import redis from 'redis';
import RedisStore from 'koa-redis';
import session from 'koa-generic-session';
import flash from 'koa-connect-flash';
import convert from 'koa-convert';
import Router from 'koa-router';

// initialize our app
const app = new Koa();

// define keys used for signing cookies
app.keys = [ 'foo', 'bar' ];

// initialize redis store
const redisClient = redis.createClient();
redisClient.on('connect', () => app.emit('log', 'info', 'redis connected'));
redisClient.on('error', err => app.emit('error', err));

// define our storage
const redisStore = new RedisStore({
  client: redisClient
});

// add sessions to our app
app.use(convert(session({
  store: redisStore
})));

// add support for flash messages (e.g. `req.flash('error', 'Oops!')`)
app.use(convert(flash()));

// override koa's undocumented error handler
app.context.onerror = errorHandler;

// set up some routes
const router = new Router();

// throw an error anywhere you want!
router.get('/404', ctx => ctx.throw(404));
router.get('/500', ctx => ctx.throw(500));

// initialize routes on the app
app.use(router.routes());

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

// start the server
app.listen(3000);
console.log('listening on port 3000');
