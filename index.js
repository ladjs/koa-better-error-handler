const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const Boom = require('@hapi/boom');
const camelCase = require('camelcase');
const capitalize = require('capitalize');
const fastSafeStringify = require('fast-safe-stringify');
const humanize = require('humanize-string');
const statuses = require('statuses');
const toIdentifier = require('toidentifier');
const { convert } = require('html-to-text');

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

// Helper functions to replace lodash dependencies
function isError(value) {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof value.message === 'string' &&
      typeof value.name === 'string')
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function isNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isString(value) {
  return typeof value === 'string';
}

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
    const logger = useCtxLogger && this.logger ? this.logger : _logger;
    try {
      if (!err) return;

      if (!isError(err)) err = new Error(err);

      // check if we have a boom error that specified
      // a status code already for us (and then use it)
      if (isObject(err.output) && isNumber(err.output.statusCode)) {
        err.status = err.output.statusCode;
      } else if (isString(err.code) && DNS_RETRY_CODES.has(err.code)) {
        // check if this was a DNS error and if so
        // then set status code for retries appropriately
        err.status = 408;
      }

      if (!isNumber(err.status)) err.status = 500;

      // set err.statusCode for consistency
      err.statusCode = err.status;

      // nothing we can do here other
      // than delegate to the app-level
      // handler and log.
      if (this.headerSent || !this.writable) {
        this.app.emit('error', err, this);
        return;
      }

      // translate messages
      const translate = (message) =>
        isFunction(this.request.t) ? this.request.t(message) : message;

      const type = this.accepts(['text', 'json', 'html']);

      if (!type) {
        err.status = 406;
        err.message = translate(Boom.notAcceptable().output.payload.message);
      }

      const val = Number.parseInt(err.message, 10);
      if (isNumber(val) && val >= 400 && val < 600) {
        // check if we threw just a status code in order to keep it simple
        err = Boom[camelCase(toIdentifier(statuses.message[val]))]();
        err.message = translate(err.message);
      } else if (isErrorConstructorName(err, 'RedisError')) {
        // redis errors (e.g. ioredis' MaxRetriesPerRequestError)
        //
        // NOTE: we have to have 500 error here to prevent endless redirect loop
        //
        err.status = type === 'html' ? 504 : 408;
        err.message = translate(
          type === 'html'
            ? Boom.gatewayTimeout().output.payload.message
            : Boom.clientTimeout().output.payload.message
        );
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
        //
        // NOTE: we have to have 500 error here to prevent endless redirect loop
        //
        err.status = type === 'html' ? 504 : 408;
        err.message = translate(
          type === 'html'
            ? Boom.gatewayTimeout().output.payload.message
            : Boom.clientTimeout().output.payload.message
        );
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

      // finalize status code after all error type checks
      err.status ||= 500;
      err.statusCode = err.status;

      // emit error event AFTER status code has been determined
      // so that error listeners (e.g. loggers) have access to the correct status
      this.app.emit('error', err, this);

      // check if there is flash messaging
      const hasFlash = isFunction(this.flash);

      // check if there is a view rendering engine binding `this.render`
      const hasRender = isFunction(this.render);

      // check if we're about to go into a possible endless redirect loop
      const noReferrer = this.get('Referrer') === '';
      this.statusCode = err.statusCode;
      this.status = this.statusCode;

      const friendlyAPIMessage = makeAPIFriendly(this, err.message);

      this.body = new Boom.Boom(friendlyAPIMessage, {
        statusCode: err.status
      }).output.payload;

      // set any additional error headers specified
      // (e.g. for BasicAuth we use `basic-auth` which specifies WWW-Authenticate)
      if (isObject(err.headers) && Object.keys(err.headers).length > 0)
        this.set(err.headers);

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
                await new Promise((resolve, reject) => {
                  this.sessionStore.set(this.sessionId, this.session, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                });
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
            await new Promise((resolve, reject) => {
              this._session._store.save(
                this._session._sid,
                stringify(this.session),
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
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
      logger.error(err);
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
  err.errors = Object.fromEntries(
    Object.entries(err.errors).map(([key, error]) => {
      if (!isString(error.path)) {
        error.message = capitalize(error.message);
        return [key, error];
      }

      error.message = error.message.replaceAll(
        new RegExp(error.path, 'g'),
        humanize(error.path)
      );
      error.message = capitalize(error.message);
      return [key, error];
    })
  );

  // loop over the errors object of the Validation Error
  // with support for HTML error lists
  const errorValues = Object.values(err.errors);
  if (errorValues.length === 1) {
    err.message = errorValues[0].message;
    if (!err.no_translate) err.message = translate(err.message);
  } else {
    const errors = errorValues.map((error) =>
      err.no_translate ? error.message : translate(error.message)
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
