# koa-better-error-handler

[![build status](https://img.shields.io/travis/ladjs/koa-better-error-handler.svg)](https://travis-ci.org/ladjs/koa-better-error-handler)
[![code coverage](https://img.shields.io/codecov/c/github/ladjs/koa-better-error-handler.svg)](https://codecov.io/gh/ladjs/koa-better-error-handler)
[![code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![made with lass](https://img.shields.io/badge/made_with-lass-95CC28.svg)](https://lass.js.org)
[![license](https://img.shields.io/github/license/ladjs/koa-better-error-handler.svg)](LICENSE)

> A better error-handler for [Lad][] and [Koa][].  Makes `ctx.throw` awesome (best used with [koa-404-handler][])


## Index

* [Features](#features)
* [Install](#install)
* [Usage](#usage)
  * [API](#api)
  * [Web App](#web-app)
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

> You should probably be using this in combination with [koa-404-handler][] too!

### API

> No support for sessions, cookies, or flash messaging:

```js
const errorHandler = require('koa-better-error-handler');
const Koa = require('koa');
const Router = require('koa-router');
const koa404Handler = require('koa-404-handler');

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
```

### Web App

> Built-in support for sessions, cookies, and flash messaging:

```js
const errorHandler = require('koa-better-error-handler');
const Koa = require('koa');
const redis = require('redis');
const RedisStore = require('koa-redis');
const session = require('koa-generic-session');
const flash = require('koa-connect-flash');
const convert = require('koa-convert');
const Router = require('koa-router');
const koa404Handler = require('koa-404-handler');

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


## Prevent Errors From Being Automatically Translated

As of v3.0.5, you can prevent an error from being automatically translated by setting the error property of `no_translate` to have a value of `true`:

```js
function middleware(ctx) {
  const err = Boom.badRequest('Uh oh!');
  err.no_translate = true; // <----
  ctx.throw(err);
}
```


## HTML Error Lists

If you specify `app.context.api = true` or set `ctx.api = true`, and if a Mongoose validation error message occurs that has more than one message (e.g. multiple fields were invalid) – then `err.message` will be joined by a comma instead of by `<li>`.

Therefore if you _DO_ want your API error messages to return HTML formatted error lists for Mongoose validation, then set `app.context.api = false`, `ctx.api = false`, or simply make sure to not set them before using this error handler.

```js
try {
  // trigger manual validation
  // (this allows us to have a 400 error code instead of 500)
  await company.validate();
} catch (err) {
  ctx.throw(Boom.badRequest(err));
}
```

> With error lists:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "<ul class=\"text-left mb-0\"><li>Path `company_logo` is required.</li><li>Gig description must be 100-300 characters.</li></ul>"
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


## API Friendly Messages

By default if `ctx.api` is true, then [html-to-text](https://github.com/werk85/node-html-to-text) will be invoked upon the `err.message`, thus converting all the HTML markup into text format.

You can also specify a base URI in the environment variable for rendering as `process.env.ERROR_HANDLER_BASE_URL`, e.g. `ERROR_HANDLER_BASE_URL=https://example.com` (omit trailing slash), and any HTML links such as `<a href="/foo/bar/baz">Click here</a>` will be converted to `[Click here][1]` with a `[1]` link appended of `https://example.com/foo/bar/baz`.


## License

[MIT](LICENSE) © Nick Baugh


## 

[boom]: https://github.com/hapijs/boom

[gh-issue]: https://github.com/koajs/koa/issues/571

[gh-500-issue]: https://github.com/koajs/koa/blob/e4bcdecef295d7adbf5cce1bdc09adc0a24117b7/lib/context.js#L94-L140

[mongoose-beautiful-unique-validation]: https://github.com/matteodelabre/mongoose-beautiful-unique-validation

[lad]: https://lad.js.org

[koa]: http://koajs.com/

[koa-404-handler]: https://github.com/ladjs/koa-404-handler
