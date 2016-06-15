'use strict';

var Transform = require('stream').Transform;
var util = require('util');
var debug = require('debug')('blockchain-download:headerstream');
var INV = require('bitcoin-protocol').constants.inventory;

var HeaderStream = module.exports = function (peers, opts) {
  var _this = this;

  if (!peers) {
    throw new Error('"peers" argument is required for HeaderStream');
  }
  if (!(this instanceof HeaderStream)) {
    return new HeaderStream(peers, opts);
  }
  Transform.call(this, { objectMode: true });
  opts = opts || {};
  this.peers = peers;
  this.timeout = opts.timeout;
  this.stop = opts.stop;
  this.getting = false;
  this.done = false;
  this.reachedTip = false;
  this.lastLocator = null;
  if (opts.endOnTip) {
    this.once('tip', function () {
      return _this.end();
    });
  }
};
util.inherits(HeaderStream, Transform);

HeaderStream.prototype._error = function (err) {
  this.emit('error', err);
};

HeaderStream.prototype._transform = function (locator, enc, cb) {
  this.lastLocator = locator;
  if (this.reachedTip) return cb(null);
  this._getHeaders(locator, cb);
};

HeaderStream.prototype._getHeaders = function (locator, peer, cb) {
  var _this2 = this;

  if (this.getting || this.done) return;
  if (typeof peer === 'function') {
    cb = peer;
    peer = null;
  }
  if (!peer) peer = this.peers;
  this.getting = true;
  peer.getHeaders(locator, {
    stop: this.stop,
    timeout: this.timeout
  }, function (err, headers, peer) {
    if (_this2.done) return cb(null);
    if (err) return _this2._error(err);
    _this2.getting = false;
    if (headers.length === 0) {
      _this2._onTip(peer);
      if (cb) cb(null);
      return;
    }
    headers.peer = peer;
    _this2.push(headers);
    if (headers.length < 2000) {
      _this2._onTip(peer);
      if (cb) cb(null);
      return;
    }
    if (_this2.stop && headers[headers.length - 1].getHash().compare(_this2.stop) === 0) {
      _this2.end();
    }
    if (cb) cb(null);
  });
};

HeaderStream.prototype.end = function () {
  if (this.done) return;
  this.done = true;
  Transform.prototype.end.call(this);
};

HeaderStream.prototype._onTip = function (peer) {
  if (this.reachedTip) return;
  debug('Reached chain tip, now listening for relayed blocks');
  this.reachedTip = true;
  this.emit('tip');
  if (!this.done) this._subscribeToInvs();
};

HeaderStream.prototype._subscribeToInvs = function () {
  var _this3 = this;

  var lastSeen = [];
  this.peers.on('inv', function (inv, peer) {
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = inv[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var item = _step.value;

        if (item.type !== INV.MSG_BLOCK) continue;
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
          for (var _iterator2 = lastSeen[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var hash = _step2.value;

            if (hash.equals(item.hash)) return;
          }
        } catch (err) {
          _didIteratorError2 = true;
          _iteratorError2 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion2 && _iterator2.return) {
              _iterator2.return();
            }
          } finally {
            if (_didIteratorError2) {
              throw _iteratorError2;
            }
          }
        }

        lastSeen.push(item.hash);
        if (lastSeen.length > 8) lastSeen.shift();
        _this3._getHeaders(_this3.lastLocator, peer);
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
  });
};