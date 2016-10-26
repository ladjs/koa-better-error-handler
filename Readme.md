
# koa-better-error-handler

[![Slack Status][slack-image]][slack-url]
[![NPM version][npm-image]][npm-url]
[![Build Status][build-image]][build-url]
[![Code Coverage][codecoverage-image]][codecoverage-url]
[![Standard JS Style][standard-image]][standard-url]
[![MIT License][license-image]][license-url]

> A better error-handler for Koa v2+, built for [CrocodileJS][crocodile-url].  Makes `ctx.throw` beautiful again :sparkles:!


## Index

* [Features](#features)
* [Install](#install)
* [Usage](#usage)
  - [API](#api)
  - [Web App](#web-app)
* [User-Friendly Responses](#user-friendly-responses)
* [HTML Error Lists](#html-error-lists)
* [License](#license)


## Features

* Uses [Boom][boom] for making error messages beautiful (see [User Friendly Responses](#user-friendly-responses) below)
* Simply a better error handler (doesn't remove all headers [like the built-in one does][gh-issue])
* Doesn't make all status codes 500 ([like the built-in Koa error handler does][gh-500-issue])
* Supports Flash messages and preservation of newly set session object
* Fixes annoying redirect issue where flash messages were lost upon an error being thrown
* Supports [HTML Error Lists](#html-error-lists) using `<ul>` for Mongoose validation errors with more than one message
* Makes `ctx.throw` beautiful messages (e.g. `ctx.throw(404)` will output a beautiful error object :hibiscus:)
* Supports `text/html`, `application/json`, and `text` response types
* Supports and recommends use of [mongoose-beautiful-unique-validation][mongoose-beautiful-unique-validation]


## Install

```bash
npm install --save koa-better-error-handler
```


## Usage

### API

> No support for sessions, cookies, or flash messaging:

```js
import errorHandler from 'koa-better-error-handler';
import Koa from 'koa';
import Router from 'koa-router';

// initialize our app
const app = new Koa();

// override koa's undocumented error handler
app.context.onerror = errorHandler;

// specify that this is our api
app.context.api = true;

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
```

### Web App

> Built-in support for sessions, cookies, and flash messaging:

```js
import errorHandler from 'koa-better-error-handler';
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
```


## User-Friendly Responses

> Example Request:

```bash
curl -H "Accept: application/json" http://localhost/some-page-does-not-exist
```

> Example Response:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message":"Not Found"
}
```


## HTML Error Lists

If you specify `app.context.api = true` or set `ctx.api = true`, and if a Mongoose validation error message occurs that has more than one message (e.g. multiple fields were invalid) &ndash; then `err.message` will be joined by a comma instead of by `<li>`.

Therefore if you _DO_ want your API error messages to return HTML formatted error lists for Mongoose validation, then set `app.context.api = true` before using this error handler.

> With error lists:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "<ul class=\"text-xs-left mb-0\"><li>Path `company_logo` is required.</li><li>Gig description must be 100-300 characters.</li></ul>"
}
```

> Without error lists:

```json
{
  "statusCode":400,
  "error":"Bad Request",
  "message":"Path `company_logo` is required., Gig description must be 100-300 characters."
}
```


## License

[MIT][license-url]


[license-image]: http://img.shields.io/badge/license-MIT-blue.svg
[license-url]: LICENSE
[npm-image]: https://img.shields.io/npm/v/koa-better-error-handler.svg
[npm-url]: https://npmjs.org/package/koa-better-error-handler
[crocodile-url]: https://crocodilejs.com
[standard-image]: https://img.shields.io/badge/code%20style-standard%2Bes7-brightgreen.svg
[standard-url]: https://github.com/crocodilejs/eslint-config-crocodile
[slack-image]: http://slack.crocodilejs.com/badge.svg
[slack-url]: http://slack.crocodilejs.com
[build-image]: https://semaphoreci.com/api/v1/niftylettuce/koa-better-error-handler/branches/master/shields_badge.svg
[build-url]: https://semaphoreci.com/niftylettuce/koa-better-error-handler
[codecoverage-image]: https://codecov.io/gh/niftylettuce/koa-better-error-handler/branch/master/graph/badge.svg
[codecoverage-url]: https://codecov.io/gh/niftylettuce/koa-better-error-handler
[boom]: https://github.com/hapijs/boom
[gh-issue]: https://github.com/koajs/koa/issues/571
[gh-500-issue]: https://github.com/koajs/koa/blob/e4bcdecef295d7adbf5cce1bdc09adc0a24117b7/lib/context.js#L94-L140
[mongoose-beautiful-unique-validation]: https://github.com/BohdanTkachenko/mongoose-beautiful-unique-validation
