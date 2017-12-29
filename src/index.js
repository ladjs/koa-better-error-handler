const fs = require('fs');
const path = require('path');
const s = require('underscore.string');
const co = require('co');
const Debug = require('debug');
const _ = require('lodash');
const Boom = require('boom');

const opts = {
  encoding: 'utf8'
};

// error pages were inspired by HTML5 Boilerplate's default 404.html page
// https://github.com/h5bp/html5-boilerplate/blob/master/src/404.html
const _404 = fs.readFileSync(path.join(__dirname, '..', '404.html'), opts);
const _500 = fs.readFileSync(path.join(__dirname, '..', '500.html'), opts);

const debug = new Debug('koa-better-error-handler');

// initialize try/catch error handling right away
// adapted from: https://github.com/koajs/onerror/blob/master/index.js
// https://github.com/koajs/examples/issues/20#issuecomment-31568401
//
// inspired by:
// https://goo.gl/62oU7P
// https://goo.gl/8Z7aMe

// eslint-disable-next-line complexity
async function errorHandler(err) {
  if (!err) return;

  if (!_.isError(err)) err = new Error(err);

  const type = this.accepts(['text', 'json', 'html']);

  if (!type) {
    debug('invalid type, sending 406 error');
    err.status = 406;
    err.message = Boom.notAcceptable().output.payload;
  }

  // parse mongoose validation errors
  err = parseValidationError(this, err);

  // check if we threw just a status code in order to keep it simple
  const val = parseInt(err.message, 10);
  if (_.isNumber(val) && val >= 400) err = Boom.create(val);

  // check if we have a boom error that specified
  // a status code already for us (and then use it)
  if (_.isObject(err.output) && _.isNumber(err.output.statusCode))
    err.status = err.output.statusCode;

  if (!_.isNumber(err.status)) err.status = 500;

  // check if there is flash messaging
  const hasFlash = _.isFunction(this.flash);
  debug('hasFlash', hasFlash);

  // check if there is session support
  const hasSessions =
    _.isObject(this.session) &&
    _.isObject(this.sessionStore) &&
    _.isString(this.sessionId) &&
    _.isObject(this.session) &&
    _.isFunction(this.sessionStore.set);
  debug('hasSessions', hasSessions);

  // check if there is a view rendering engine binding `this.render`
  const hasRender = _.isFunction(this.render);
  debug('hasRender', hasRender);

  // check if we're about to go into a possible endless redirect loop
  const noReferrer = this.get('Referrer') === '';

  // nothing we can do here other
  // than delegate to the app-level
  // handler and log.
  if (this.headerSent || !this.writable) {
    debug('headers were already sent, returning early');
    err.headerSent = true;
    return;
  }

  // populate the status and body with `boom` error message payload
  // (e.g. you can do `ctx.throw(404)` and it will output a beautiful err obj)
  err.status = err.status || 500;
  err.statusCode = err.status;
  this.statusCode = err.statusCode;
  this.status = this.statusCode;
  this.body = new Boom(err.message, { statusCode: err.status }).output.payload;

  debug('status code was %d', this.status);

  this.app.emit('error', err, this);

  // fix page title and description
  this.state.meta = this.state.meta || {};
  this.state.meta.title = this.body.error;
  this.state.meta.description = err.message;
  debug('set `this.state.meta.title` to %s', this.state.meta.title);
  debug('set `this.state.meta.desc` to %s', this.state.meta.description);

  debug('type was %s', type);

  switch (type) {
    case 'html':
      this.type = 'html';

      if (this.status === 404) {
        // render the 404 page
        // https://github.com/koajs/koa/issues/646
        if (hasRender) {
          try {
            debug('rendering 404 page');
            await this.render('404');
          } catch (err) {
            debug('could not find 404 page, using built-in 404 html');
            this.body = _404;
          }
        } else {
          this.body = _404;
        }
      } else if (noReferrer || this.status === 500) {
        // this prevents a redirect loop by detecting an empty Referrer
        // ...otherwise it would reach the next conditional block which
        // would endlessly rediret the user with `this.redirect('back')`
        if (noReferrer) debug('prevented endless redirect loop!');

        // flash an error message
        if (hasFlash) this.flash('error', err.message);

        // render the 500 page
        if (hasRender) {
          try {
            debug('rendering 500 page');
            await this.render('500');
          } catch (err) {
            debug('could not find 500 page, using built-in 500 html');
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
          this.state.cookiesKey
        ) {
          await co
            .wrap(this.sessionStore.set)
            .call(this.sessionStore, this.sessionId, this.session);
          this.cookies.set(
            this.state.cookiesKey,
            this.sessionId,
            this.session.cookie
          );
        }

        /*
        // if we're using `koa-session-store` we need to add
        // `this._session = new Session()`, and then run this:
        await co.wrap(this._session._store.save).call(
          this._session._store,
          this._session._sid,
          JSON.stringify(this.session)
        );
        this.cookies.set(this._session._name, JSON.stringify({
          _sid: this._session._sid
        }), this._session._cookieOpts);
        */

        // redirect the user to the page they were just on
        this.redirect('back');
      }
      break;
    case 'json':
      this.type = 'json';
      this.body = JSON.stringify(this.body, null, 2);
      break;
    default:
      this.type = 'text';
      this.body = JSON.stringify(this.body, null, 2);
      break;
  }

  this.length = Buffer.byteLength(this.body);
  this.res.end(this.body);
}

function parseValidationError(ctx, err) {
  // inspired by https://github.com/syntagma/mongoose-error-helper
  if (err.name !== 'ValidationError') return err;

  ctx.api = true;

  // transform the error messages to be humanized as adapted from:
  // https://github.com/niftylettuce/mongoose-validation-error-transform
  err.errors = _.map(err.errors, error => {
    if (!_.isString(error.path)) {
      error.message = s.capitalize(error.message);
      return error;
    }
    error.message = error.message.replace(
      new RegExp(error.path, 'g'),
      s.humanize(error.path)
    );
    error.message = s.capitalize(error.message);
    return error;
  });

  // loop over the errors object of the Validation Error
  // with support for HTML error lists
  if (_.values(err.errors).length === 1) {
    err.message = _.values(err.errors)[0].message;
  } else {
    const errors = _.map(_.values(err.errors), 'message');
    err.message = ctx.api
      ? errors.join(', ')
      : `<ul class="text-xs-left mb-0"><li>${errors.join(
          '</li><li>'
        )}</li></ul>`;
  }

  return err;
}

module.exports = errorHandler;
