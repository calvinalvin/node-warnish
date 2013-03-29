/**
* ~~ Warnish Accelerate ~~
* Copyright (c) 2013 Calvin Oh <calvin@edtwist.com>
* MIT LICENSED: http://en.wikipedia.org/wiki/MIT_License
*
* Options:
*
* - `redis`: an options object that is passed onto redis.createClient(port, host, options)
* see node_redis for more details: https://github.com/mranney/node_redis
* redis: {
*     port: 6379,
*     host: '127.0.0.1',
*     options: redisOptions
* }
*
*/

/**
* Module dependencies.
*/

var util = require('util')
  , zlib = require('zlib')
  , redis = require('redis')
  , redisRStream = require('./redis-rstream');


module.exports = function accelerate(options) {
    options = options || {};
    options.redis = options.redis || {};

    var names = Object.keys(exports.methods)
    , filter = options.filter || exports.filter

    var redisOpts = options.redis || {
        port: 6379,
        host: '127.0.0.1'
    };

    // make sure redis detect_buffers is true
    if (redisOpts.options)
        redisOpts.options.detect_buffers = true;
    else
        redisOpts.options = { detect_buffers: true };

    // connect to redis and bind events
    var redisClient = redis.createClient(
        redisOpts.port,
        redisOpts.host,
        redisOpts.options);

    redisClient
    .on('ready', function () {
        console.log('warnish-accelerate: redis client is ready %s:%s', this.host, this.port);
    })
    .on('connect', function () {
        console.log('warnish-accelerate: redis client is connected %s:%s', this.host, this.port);
    })
    .on('error', function (err) {
        throw new Error('warnish-accelerate: ' + err);
    });

    return function accelerate(req, res, next) {
        var accept = req.headers['accept-encoding']
          , vary = res.getHeader('Vary')
          , method
          , cacheKey
          , headerKey;

        // vary
        if (!vary) {
            res.setHeader('Vary', 'Accept-Encoding');
        } else if (! ~vary.indexOf('Accept-Encoding')) {
            res.setHeader('Vary', vary + ', Accept-Encoding');
        }

        res.setHeader('X-Powered-By', 'Warnish');

        var encoding = res.getHeader('Content-Encoding') || 'identity';


        // already encoded
        if ('identity' != encoding) return next();

        // SHOULD use identity
        if (!accept) return next();

        // head
        if ('HEAD' == req.method) return next();

        // default to gzip
        if ('*' == accept.trim()) method = 'gzip';


        // compression method
        if (!method) {
            for (var i = 0, len = names.length; i < len; ++i) {
                if (~accept.indexOf(names[i])) {
                    method = names[i];
                    break;
                }
            }
        }

        cacheKey = util.format('warnish-cache:%s:%s', method ? method : 'identity', req.url);
        headerKey = util.format('warnish-headers:%s:%s', method ? method : 'identity', req.url);

        redisClient.exists(cacheKey, function (err, reply) {
            if (err) return next(err);

            if (reply === '1') {
                redisClient.hgetall(headerKey, function (err, reply) {
                    if (err) next();

                    // set any headers from cache
                    if (reply != null) {
                        for (var key in reply) 
                            res.setHeader(key, reply[key]);
                    }

                    res.setHeader('Content-Encoding', method);
                    res.setHeader('X-Powered-By', 'Warnish');

                    console.log('cache HIT ' + cacheKey);
                    var stream = redisRStream(redisClient, cacheKey);
                    return stream.pipe(res);
                });
            }
            else {
                return next();
            }
        });
    };
}




