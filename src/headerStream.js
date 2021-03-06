var Transform = require('stream').Transform
var util = require('util')
var debug = require('debug')('blockchain-download:headerstream')
var INV = require('bitcoin-protocol').constants.inventory

var HeaderStream = module.exports = function (peers, opts) {
  if (!peers) {
    throw new Error('"peers" argument is required for HeaderStream')
  }
  if (!(this instanceof HeaderStream)) {
    return new HeaderStream(peers, opts)
  }
  Transform.call(this, { objectMode: true })
  opts = opts || {}
  this.peers = peers
  this.timeout = opts.timeout
  this.stop = opts.stop
  this.getting = false
  this.done = false
  this.reachedTip = false
  this.lastLocator = null
  if (opts.endOnTip) {
    this.once('tip', () => this.end())
  }
}
util.inherits(HeaderStream, Transform)

HeaderStream.prototype._error = function (err) {
  this.emit('error', err)
}

HeaderStream.prototype._transform = function (locator, enc, cb) {
  this.lastLocator = locator
  if (this.reachedTip) return cb(null)
  this._getHeaders(locator, cb)
}

HeaderStream.prototype._getHeaders = function (locator, peer, cb) {
  if (this.getting || this.done) return
  if (typeof peer === 'function') {
    cb = peer
    peer = null
  }
  if (!peer) peer = this.peers
  this.getting = true
  peer.getHeaders(locator, {
    stop: this.stop,
    timeout: this.timeout
  }, (err, headers, peer) => {
    if (this.done) return cb(null)
    if (err) return this._error(err)
    this.getting = false
    if (headers.length === 0) {
      this._onTip(peer)
      if (cb) cb(null)
      return
    }
    headers.peer = peer
    this.push(headers)
    if (headers.length < 2000) {
      this._onTip(peer)
      if (cb) cb(null)
      return
    }
    if (this.stop &&
    headers[headers.length - 1].getHash().compare(this.stop) === 0) {
      this.end()
    }
    if (cb) cb(null)
  })
}

HeaderStream.prototype.end = function () {
  if (this.done) return
  this.done = true
  Transform.prototype.end.call(this)
}

HeaderStream.prototype._onTip = function (peer) {
  if (this.reachedTip) return
  debug('Reached chain tip, now listening for relayed blocks')
  this.reachedTip = true
  this.emit('tip')
  if (!this.done) this._subscribeToInvs()
}

HeaderStream.prototype._subscribeToInvs = function () {
  var lastSeen = []
  this.peers.on('inv', (inv, peer) => {
    for (let item of inv) {
      if (item.type !== INV.MSG_BLOCK) continue
      for (let hash of lastSeen) {
        if (hash.equals(item.hash)) return
      }
      lastSeen.push(item.hash)
      if (lastSeen.length > 8) lastSeen.shift()
      this._getHeaders(this.lastLocator, peer)
    }
  })
}
