const fs = require('fs');
const path = require('path');
const process = require('process');
const { Buffer } = require('buffer');

const Boom = require('@hapi/boom');
const camelCase = require('camelcase');
const capitalize = require('capitalize');
const co = require('co');
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

// NOTE: if you change this, be sure to sync in `forward-email`
// <https://github.com/nodejs/node/blob/08dd4b1723b20d56fbedf37d52e736fe09715f80/lib/dns.js#L296-L320>
const CODES_TO_RESPONSE_CODES = {
  EADDRGETNETWORKPARAMS: 421,
  EADDRINUSE: 421,
  EAI_AGAIN: 421,
  EBADFLAGS: 421,
  EBADHINTS: 421,
  ECANCELLED: 421,
  ECONNREFUSED: 421,
  ECONNRESET: 442,
  EDESTRUCTION: 421,
  EFORMERR: 421,
  ELOADIPHLPAPI: 421,
  ENETUNREACH: 421,
  ENODATA: 421,
  ENOMEM: 421,
  ENOTFOUND: 421,
  ENOTINITIALIZED: 421,
  EPIPE: 421,
  EREFUSED: 421,
  ESERVFAIL: 421,
  ETIMEOUT: 420
};

const RETRY_CODES = Object.keys(CODES_TO_RESPONSE_CODES);

const opts = {
  encoding: 'utf8'
};

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

// initialize try/catch error handling right away
// adapted from: https://github.com/koajs/onerror/blob/master/index.js
// https://github.com/koajs/examples/issues/20#issuecomment-31568401
//
// inspired by:
// https://goo.gl/62oU7P
// https://goo.gl/8Z7aMe

function errorHandler(
  cookiesKey = false,
  _logger = console,
  useCtxLogger = true, // useful if you have ctx.logger (e.g. you're using Cabin's middleware)
  stringify = fastSafeStringify // you could alternatively use JSON.stringify
) {
  // eslint-disable-next-line complexity
  return async function (err) {
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

    const logger = useCtxLogger && this.logger ? this.logger : _logger;

    if (!_isError(err)) err = new Error(err);

    const type = this.accepts(['text', 'json', 'html']);

    if (!type) {
      logger.warn('invalid type, sending 406 error');
      err.status = 406;
      err.message = Boom.notAcceptable().output.payload;
    }

    // parse mongoose validation errors
    err = parseValidationError(this, err);

    // check if we threw just a status code in order to keep it simple
    const val = Number.parseInt(err.message, 10);
    if (_isNumber(val) && val >= 400)
      err = Boom[camelCase(toIdentifier(statuses.message[val]))]();

    // check if we have a boom error that specified
    // a status code already for us (and then use it)
    if (_isObject(err.output) && _isNumber(err.output.statusCode)) {
      err.status = err.output.statusCode;
    } else if (_isString(err.code) && RETRY_CODES.includes(err.code)) {
      // check if this was a DNS error and if so
      // then set status code for retries appropriately
      err.status = CODES_TO_RESPONSE_CODES[err.code];
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
    if (!this.api) {
      this.state.meta = this.state.meta || {};
      if (!err.no_translate && _isFunction(this.request.t)) {
        this.state.meta.title = this.request.t(this.body.error);
        this.state.meta.description = this.request.t(err.message);
      } else {
        this.state.meta.title = this.body.error;
        this.state.meta.description = err.message;
      }
    }

    switch (type) {
      case 'html':
        this.type = 'html';

        if (this.status === 404) {
          // render the 404 page
          // https://github.com/koajs/koa/issues/646
          if (hasRender) {
            try {
              await this.render('404');
            } catch (err_) {
              logger.error(err_);
              this.body = _404;
            }
          } else {
            this.body = _404;
          }
        } else if (noReferrer || this.status === 500) {
          // this prevents a redirect loop by detecting an empty Referrer
          // ...otherwise it would reach the next conditional block which
          // would endlessly rediret the user with `this.redirect('back')`

          // flash an error message
          if (hasFlash) this.flash('error', err.message);

          // render the 500 page
          if (hasRender) {
            try {
              await this.render('500');
            } catch (err_) {
              logger.error(err_);
              this.body = _500;
            }
          } else {
            this.body = _500;
          }
        } else {
          // flash an error message
          if (hasFlash) this.flash('error', err.message);

          // TODO: until the issue is resolved, we need to add this here
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
              this.cookies.set(cookiesKey, this.sessionId, this.session.cookie);
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
      case 'json':
        this.type = 'json';
        this.body = stringify(this.body, null, 2);
        break;
      default:
        this.type = this.api ? 'json' : 'text';
        this.body = stringify(this.body, null, 2);
        break;
    }

    this.length = Buffer.byteLength(this.body);
    this.res.end(this.body);
  };
}

function makeAPIFriendly(ctx, message) {
  return ctx.api
    ? convert(message, {
        wordwrap: false,
        hideLinkHrefIfSameAsText: true,
        selectors: [
          {
            selector: 'a',
            options: {
              baseUrl: process.env.ERROR_HANDLER_BASE_URL
                ? process.env.ERROR_HANDLER_BASE_URL
                : ''
            }
          },
          { selector: 'img', format: 'skip' }
        ]
      })
    : message;
}

function parseValidationError(ctx, err) {
  // translate messages
  const translate = (message) =>
    !err.no_translate && _isFunction(ctx.request.t)
      ? ctx.request.t(message)
      : message;

  // passport-local-mongoose support
  if (passportLocalMongooseErrorNames.has(err.name)) {
    err.message = translate(err.message);
    // this ensures the error shows up client-side
    err.status = 400;
    // 429 = too many requests
    if (['AttemptTooSoonError', 'TooManyAttemptsError'].includes(err.name))
      err.status = 429;
    return err;
  }

  // inspired by https://github.com/syntagma/mongoose-error-helper
  if (err.name !== 'ValidationError') return err;

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
    err.message = translate(_values(err.errors)[0].message);
  } else {
    const errors = _map(_map(_values(err.errors), 'message'), translate);
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
