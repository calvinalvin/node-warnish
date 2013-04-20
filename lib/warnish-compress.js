/*!
* ~~ Warnish Compress ~~
* Redis-backed - compression + cache middleware for Connect - web accelerator
* by Calvin Oh, Copyright(c) 2013 Calvin Oh <calvin@edtwist.com>
* MIT Licensed: http://en.wikipedia.org/wiki/MIT_License
*
* based on compress by TJ Holowaychuk 
* https://github.com/senchalabs/connect/blob/master/lib/middleware/compress.js
* Copyright(c) 2010 Sencha Inc, Copyright(c) 2011 TJ Holowaychuk
* MIT Licensed
*/

/**
* Module dependencies.
*/

var util = require('util')
  , zlib = require('zlib')
  , redis = require('redis')
  , colors = require('colors');

/**
* Supported content-encoding methods.
*/

exports.methods = {
    gzip: zlib.createGzip
  , deflate: zlib.createDeflate
};

/**
* Default filter function.
*/

exports.filter = function (req, res) {
    //default filters from compress - too restrictive
    //return /json|text|javascript/.test(res.getHeader('Content-Type'));
    
    //warnish default - don't filter any types
    return true;
};

/**
* Warnish Compress:
*
* Compress response data with gzip/deflate - and save into redis.
* Use Warnish Accelerate to retrieve the cached values
*
* Filter:
*
* A `filter` callback function may be passed to
* replace the default logic of:
*
* compress defaults:
* exports.filter = function(req, res){
* return /json|text|javascript/.test(res.getHeader('Content-Type'));
* };
*
* NOTE: warnish defaults to no filtering
*
*
* Options:
*
* All remaining options are passed to the gzip/deflate
* creation functions. Consult node's docs for additional details.
*
* - `chunkSize` (default: 16*1024)
* - `windowBits`
* - `level`: 0-9 where 0 is no compression, and 9 is slow but best compression
* - `memLevel`: 1-9 low is slower but uses less memory, high is fast but uses more
* - `strategy`: compression strategy
* - `redis`: an object that contains configuration settings for connecting to redis
*    basically this is passed on to node_redis module https://github.com/mranney/node_redis
*    example: 
*             redis: {
*               port: 6379,
*               host: '127.0.0.1',
*               options: redisOptions
*             }
*
* - `ignoreVerbs` : the verbs to be ignored. Any ignored verb will not be cached into redis
*    by default 'PUT', 'DELETE', 'HEAD', 'POST' are ignored
*
* @param {Object} options
* @return {Function}
* @api public
*/

module.exports = function compress(options) {
    options = options || {};
    options.redis = options.redis || {};
    options.ignoreVerbs = options.ignoreVerbs || ['PUT', 'DELETE', 'HEAD', 'POST'];

    // set default zlib options for higher compression levels
    options.level = options.level || 9;
    options.memLevel = options.memLevel || 9;

    //make sure all ignoreVerbs are uppercase
    options.ignoreVerbs.forEach(function (el, i, array) {
        array[i] = el.toUpperCase();
    });

    var names = Object.keys(exports.methods)
    , filter = options.filter || exports.filter;

    if (options.client) {
        redisClient = options.client;
        console.log('warnish-compress'.cyan + ': redis client set as: %s:%s', options.client.port.host, options.client.port.port);
    }
    else {
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

        if (redisOpts.pass)
            redisClient.auth(redisOpts.pass);
        
        redisClient
        .on('ready', function () {
            console.log('warnish-compress'.cyan + ': redis client is ready %s:%s', this.host, this.port);
        })
        .on('connect', function () {
            console.log('warnish-compress'.cyan + ': redis client is connected %s:%s', this.host, this.port);
        })
        .on('error', function (err) {
            throw new Error('warnish-compress: Error '.red + err);
        });
    }

    function writeRedis(key, chunk, expires, next) {
        redisClient.exists(key, function (err, reply) {
            if (err) return;

            if (reply === '1') {
                redisClient.append(key, chunk, function (err, reply) {
                    return next();
                });
            } 
            else {
                redisClient.setex(key, expires, chunk, function (err, reply) {
                    return next();
                })
            }
        });
    }

    return function compress(req, res, next) {
        var accept = req.headers['accept-encoding']
          , contentType
          , vary = res.getHeader('Vary')
          , write = res.write //save original
          , end = res.end //save original
          , stream
          , method
          , cacheKey
          , headerKey
          , ignoreVerbs = options.ignoreVerbs
          , cacheExpires = options.cacheExpires || 3600;

        // vary
        if (!vary) {
            res.setHeader('Vary', 'Accept-Encoding');
        } else if (! ~vary.indexOf('Accept-Encoding')) {
            res.setHeader('Vary', vary + ', Accept-Encoding');
        }

        // proxy
        res.write = function (chunk, encoding) {
            if (!this.headerSent) this._implicitHeader();

            return stream
                ? stream.write(new Buffer(chunk, encoding))
                : write.call(res, chunk, encoding);
        };

        res.end = function (chunk, encoding) {
            if (chunk) this.write(chunk, encoding);

            return stream
                ? stream.end()
                : end.call(res);
        };

        res.on('header', function () {
            var encoding = res.getHeader('Content-Encoding') || 'identity';

            // already encoded
            if ('identity' != encoding) return;

            // default request filter
            if (!filter(req, res)) return;

            // SHOULD use identity
            if (!accept) return;

            // head
            if ('HEAD' == req.method) return;

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

            contentType = res.getHeader('Content-Type');

            // compression method
            if (!method) return;

            // compression stream
            stream = exports.methods[method](options);

            // header fields
            res.setHeader('Content-Encoding', method);
            res.removeHeader('Content-Length');

            // compression

            stream.on('data', function (chunk) {
                // write compressed data to redis
                // but ignore verbs that were sent into options
                if (ignoreVerbs.indexOf(req.method) == -1) {
                    cacheKey = util.format('warnish-cache:%s:%s', method ? method : 'identity', req.url);
                    headerKey = util.format('warnish-headers:%s:%s', method ? method : 'identity', req.url);
                    console.log('warnish-compress'.cyan + ': saving compressed response into redis. KEY: %s', cacheKey);
                    
                    writeRedis(cacheKey, chunk, cacheExpires, function() {
                        if (typeof contentType !== 'undefined' && contentType)
                            redisClient.hset(headerKey, 'Content-Type', contentType.replace(/ /g, ''));

                        redisClient.hset(headerKey, 'Last-Modified', new Date().toUTCString());

                        write.call(res, chunk);
                    });
                }
                else {
                    write.call(res, chunk);
                }
            });

            stream.on('end', function () {
                end.call(res);
            });

            stream.on('drain', function () {
                res.emit('drain');
            });
        });

        next();
    };
};