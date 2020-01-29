const Koa = require('koa');
const Router = require('koa-router');
const koa404Handler = require('koa-404-handler');

const errorHandler = require('..');

// initialize our app
const app = new Koa();

// override koa's undocumented error handler
app.context.onerror = errorHandler;

// specify that this is our api
app.context.api = true;

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
