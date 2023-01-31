const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { Buffer } = require('node:buffer');

const co = require('co');
const Boom = require('@hapi/boom');
const camelCase = require('camelcase');
const capitalize = require('capitalize');
const fastSafeStringify = require('fast-safe-stringify');
const humanize = require('humanize-string');
const statuses = require('statuses');
const toIdentifier = require('toidentifier');
const { convert } = require('html-to-text');

// lodash
const _isError = require('lodash.iserror');
const _isFunction = require('lodash.isfunction');
const _isNumber = require('lodash.isnumber');
const _isObject = require('lodash.isobject');
const _isString = require('lodash.isstring');
const _map = require('lodash.map');
const _values = require('lodash.values');

// <https://github.com/nodejs/node/blob/08dd4b1723b20d56fbedf37d52e736fe09715f80/lib/dns.js#L296-L320>
const DNS_RETRY_CODES = new Set([
  'EADDRGETNETWORKPARAMS',
  'EBADFAMILY',
  'EBADFLAGS',
  'EBADHINTS',
  'EBADNAME',
  'EBADQUERY',
  'EBADRESP',
  'EBADSTR',
  'ECANCELLED',
  'ECONNREFUSED',
  'EDESTRUCTION',
  'EFILE',
  'EFORMERR',
  'ELOADIPHLPAPI',
  'ENODATA',
  'ENOMEM',
  'ENONAME',
  'ENOTFOUND',
  'ENOTIMP',
  'ENOTINITIALIZED',
  'EOF',
  'EREFUSED',
  'ESERVFAIL',
  'ETIMEOUT'
]);

const opts = {
  encoding: 'utf8'
};

function isErrorConstructorName(err, name) {
  const names = [];

  let e = err;
  while (e) {
    if (!e || !e.name || names.includes(e.name)) break;
    names.push(e.name);
    if (
      !err.constructor ||
      !Object.getPrototypeOf(err.constructor).name ||
      names.includes(Object.getPrototypeOf(err.constructor).name)
    )
      break;
    names.push(Object.getPrototypeOf(err.constructor).name);
    if (
      !Object.getPrototypeOf(Object.getPrototypeOf(err.constructor)).name ||
      names.includes(
        Object.getPrototypeOf(Object.getPrototypeOf(err.constructor)).name
      )
    )
      break;
    names.push(
      Object.getPrototypeOf(Object.getPrototypeOf(err.constructor)).name
    );
    e = Object.getPrototypeOf(e.constructor);
  }

  return names.includes(name);
}

//
// NOTE: we could eventually use this https://github.com/alexphelps/server-error-pages/
//
// error pages were inspired by HTML5 Boilerplate's default 404.html page
// https://github.com/h5bp/html5-boilerplate/blob/master/src/404.html
const _404 = fs.readFileSync(path.join(__dirname, '404.html'), opts);
const _500 = fs.readFileSync(path.join(__dirname, '500.html'), opts);

const passportLocalMongooseErrorNames = new Set([
  'AuthenticationError',
  'MissingPasswordError',
  'AttemptTooSoonError',
  'TooManyAttemptsError',
  'NoSaltValueStoredError',
  'IncorrectPasswordError',
  'IncorrectUsernameError',
  'MissingUsernameError',
  'UserExistsError'
]);

const passportLocalMongooseTooManyRequests = new Set([
  'AttemptTooSoonError',
  'TooManyAttemptsError'
]);

//
// initialize try/catch error handling right away
// adapted from: https://github.com/koajs/onerror/blob/master/index.js
// https://github.com/koajs/examples/issues/20#issuecomment-31568401
//
// inspired by:
// https://github.com/koajs/koa/blob/9f80296fc49fa0c03db939e866215f3721fcbbc6/lib/context.js#L101-L139
//

function errorHandler(
  cookiesKey = false,
  _logger = console,
  useCtxLogger = true, // useful if you have ctx.logger (e.g. you're using Cabin's middleware)
  stringify = fastSafeStringify // you could alternatively use JSON.stringify
) {
  // eslint-disable-next-line complexity
  return async function (err) {
    try {
      if (!err) return;

      // nothing we can do here other
      // than delegate to the app-level
      // handler and log.
      if (this.headerSent || !this.writable) {
        err.headerSent = true;
        this.app.emit('error', err, this);
        this.app.emit(
          'error',
          new Error('Headers were already sent, returning early'),
          this
        );
        return;
      }

      // translate messages
      const translate = (message) =>
        _isFunction(this.request.t) ? this.request.t(message) : message;

      const logger = useCtxLogger && this.logger ? this.logger : _logger;

      if (!_isError(err)) err = new Error(err);

      const type = this.accepts(['text', 'json', 'html']);

      if (!type) {
        err.status = 406;
        err.message = translate(Boom.notAcceptable().output.payload.message);
      }

      const val = Number.parseInt(err.message, 10);
      if (_isNumber(val) && val >= 400 && val < 600) {
        // check if we threw just a status code in order to keep it simple
        err = Boom[camelCase(toIdentifier(statuses.message[val]))]();
        err.message = translate(err.message);
      } else if (isErrorConstructorName(err, 'RedisError')) {
        // redis errors (e.g. ioredis' MaxRetriesPerRequestError)
        err.status = 408;
        err.message = translate(Boom.clientTimeout().output.payload.message);
      } else if (passportLocalMongooseErrorNames.has(err.name)) {
        // passport-local-mongoose support
        if (!err.no_translate) err.message = translate(err.message);
        // this ensures the error shows up client-side
        err.status = 400;
        // 429 = too many requests
        if (passportLocalMongooseTooManyRequests.has(err.name))
          err.status = 429;
      } else if (
        err.name === 'ValidationError' &&
        isErrorConstructorName(err, 'MongooseError')
      ) {
        // parse mongoose validation errors
        err = parseValidationError(this, err, translate);
      } else if (
        isErrorConstructorName(err, 'MongoError') ||
        isErrorConstructorName(err, 'MongooseError')
      ) {
        // parse mongoose (and mongodb connection errors)
        err.status = 408;
        err.message = translate(Boom.clientTimeout().output.payload.message);
      } else if (
        // prevent code related bugs from
        // displaying to users in production environments
        process.env.NODE_ENV === 'production' &&
        (err instanceof TypeError ||
          err instanceof SyntaxError ||
          err instanceof ReferenceError ||
          err instanceof RangeError ||
          err instanceof URIError ||
          err instanceof EvalError)
      ) {
        err.isCodeBug = true;
        err.message = translate(Boom.internal().output.payload.message);
      }

      // check if we have a boom error that specified
      // a status code already for us (and then use it)
      if (_isObject(err.output) && _isNumber(err.output.statusCode)) {
        err.status = err.output.statusCode;
      } else if (_isString(err.code) && DNS_RETRY_CODES.has(err.code)) {
        // check if this was a DNS error and if so
        // then set status code for retries appropriately
        err.status = 408;
        err.message = translate(Boom.clientTimeout().output.payload.message);
      }

      if (!_isNumber(err.status)) err.status = 500;

      // check if there is flash messaging
      const hasFlash = _isFunction(this.flash);

      // check if there is a view rendering engine binding `this.render`
      const hasRender = _isFunction(this.render);

      // check if we're about to go into a possible endless redirect loop
      const noReferrer = this.get('Referrer') === '';

      // populate the status and body with `boom` error message payload
      // (e.g. you can do `ctx.throw(404)` and it will output a beautiful err obj)
      err.status = err.status || 500;
      err.statusCode = err.status;
      this.statusCode = err.statusCode;
      this.status = this.statusCode;

      const friendlyAPIMessage = makeAPIFriendly(this, err.message);

      this.body = new Boom.Boom(friendlyAPIMessage, {
        statusCode: err.status
      }).output.payload;

      // set any additional error headers specified
      // (e.g. for BasicAuth we use `basic-auth` which specifies WWW-Authenticate)
      if (_isObject(err.headers) && Object.keys(err.headers).length > 0)
        this.set(err.headers);

      this.app.emit('error', err, this);

      // fix page title and description
      const meta = {
        title: this.body.error,
        description: err.message
      };

      switch (type) {
        case 'html': {
          this.type = 'html';

          if (this.status === 404) {
            // render the 404 page
            // https://github.com/koajs/koa/issues/646
            if (hasRender) {
              try {
                await this.render('404', { meta });
              } catch (err_) {
                logger.error(err_);
                this.body = _404;
              }
            } else {
              this.body = _404;
            }
          } else if (noReferrer || this.status >= 500) {
            // flash an error message
            if (hasFlash) this.flash('error', err.message);

            // render the 5xx page
            if (hasRender) {
              try {
                await this.render('500', { meta });
              } catch (err_) {
                logger.error(err_);
                this.body = _500;
              }
            } else {
              this.body = _500;
            }
          } else {
            //
            // attempt to redirect the user back
            //

            // flash an error message
            if (hasFlash) this.flash('error', err.message);

            // NOTE: until the issue is resolved, we need to add this here
            // <https://github.com/koajs/generic-session/pull/95#issuecomment-246308544>
            if (
              this.sessionStore &&
              this.sessionId &&
              this.session &&
              cookiesKey
            ) {
              try {
                await co
                  .wrap(this.sessionStore.set)
                  .call(this.sessionStore, this.sessionId, this.session);
                this.cookies.set(
                  cookiesKey,
                  this.sessionId,
                  this.session.cookie
                );
              } catch (err) {
                logger.error(err);
                if (err.code === 'ERR_HTTP_HEADERS_SENT') return;
              }
            }

            /*
            // TODO: we need to add support for `koa-session-store` here
            // <https://github.com/koajs/generic-session/pull/95#issuecomment-246308544>
            //
            // these comments may no longer be valid and need reconsidered:
            //
            // if we're using `koa-session-store` we need to add
            // `this._session = new Session()`, and then run this:
            await co.wrap(this._session._store.save).call(
              this._session._store,
              this._session._sid,
              stringify(this.session)
            );
            this.cookies.set(this._session._name, stringify({
              _sid: this._session._sid
            }), this._session._cookieOpts);
            */

            // redirect the user to the page they were just on
            this.redirect('back');
          }

          break;
        }

        case 'json': {
          this.type = 'json';
          this.body = stringify(this.body, null, 2);
          break;
        }

        default: {
          this.type = this.api ? 'json' : 'text';
          this.body = stringify(this.body, null, 2);
          break;
        }
      }
    } catch (err) {
      _logger.error(err);
      this.status = 500;
      this.body = 'Internal Server Error';
    }

    if (!this.headerSent || this.writeable) {
      this.length = Buffer.byteLength(this.body);
      this.res.end(this.body);
    }
  };
}

function makeAPIFriendly(ctx, message) {
  return ctx.api
    ? convert(message, {
        wordwrap: false,
        selectors: [
          {
            selector: 'a',
            options: {
              hideLinkHrefIfSameAsText: true,
              baseUrl: process.env.ERROR_HANDLER_BASE_URL || ''
            }
          },
          { selector: 'img', format: 'skip' }
        ],
        linkBrackets: false
      })
    : message;
}

// inspired by https://github.com/syntagma/mongoose-error-helper
function parseValidationError(ctx, err, translate) {
  // transform the error messages to be humanized as adapted from:
  // https://github.com/niftylettuce/mongoose-validation-error-transform
  err.errors = _map(err.errors, (error) => {
    if (!_isString(error.path)) {
      error.message = capitalize(error.message);
      return error;
    }

    error.message = error.message.replace(
      new RegExp(error.path, 'g'),
      humanize(error.path)
    );
    error.message = capitalize(error.message);
    return error;
  });

  // loop over the errors object of the Validation Error
  // with support for HTML error lists
  if (_values(err.errors).length === 1) {
    err.message = _values(err.errors)[0].message;
    if (!err.no_translate) err.message = translate(err.message);
  } else {
    const errors = _map(_map(_values(err.errors), 'message'), (message) =>
      err.no_translate ? message : translate(message)
    );
    err.message = makeAPIFriendly(
      ctx,
      `<ul class="text-left mb-0"><li>${errors.join('</li><li>')}</li></ul>`
    );
  }

  // this ensures the error shows up client-side
  err.status = 400;

  return err;
}

module.exports = errorHandler;
