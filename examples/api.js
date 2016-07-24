
import errorHandler from '../';
import Koa from 'koa';
import Router from 'koa-router';

// initialize our app
const app = new Koa();

// override koa's undocumented error handler
app.context.onerror = errorHandler;

// set up some routes
const router = new Router();

// throw an error anywhere you want!
router.get('/404', ctx => ctx.throw(404));
router.get('/500', ctx => ctx.throw(500));

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

// start the server
app.listen(3000);
console.log('listening on port 3000');
