const Koa = require('koa');
const redis = require('redis');
const RedisStore = require('koa-redis');
const session = require('koa-generic-session');
const flash = require('koa-connect-flash');
const convert = require('koa-convert');
const Router = require('koa-router');
const koa404Handler = require('koa-404-handler');

const errorHandler = require('..');

// initialize our app
const app = new Koa();

// define keys used for signing cookies
app.keys = ['foo', 'bar'];

// initialize redis store
const redisClient = redis.createClient();
redisClient.on('connect', () => app.emit('log', 'info', 'redis connected'));
redisClient.on('error', err => app.emit('error', err));

// define our storage
const redisStore = new RedisStore({
  client: redisClient
});

// add sessions to our app
app.use(
  convert(
    session({
      store: redisStore
    })
  )
);

// add support for flash messages (e.g. `req.flash('error', 'Oops!')`)
app.use(convert(flash()));

// override koa's undocumented error handler
app.context.onerror = errorHandler;

// use koa-404-handler
app.use(koa404Handler);

// set up some routes
const router = new Router();

// throw an error anywhere you want!
router.get('/404', ctx => ctx.throw(404));
router.get('/500', ctx => ctx.throw(500));

// initialize routes on the app
app.use(router.routes());

// start the server
app.listen(3000);
console.log('listening on port 3000');
