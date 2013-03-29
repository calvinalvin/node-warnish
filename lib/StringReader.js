﻿/*
** StringReader - A Readable stream for a string or Buffer.
** This works for both strings and Buffers.
** usage example: http://technosophos.com/content/using-string-stream-reader-nodejs
** taken from Pronto.js - https://github.com/technosophos/Pronto.js/blob/master/lib/streams/stringreader.js
** 
** Pronto.js: Evented Chain of Command
** Matt Butcher <mbutcher@aleph-null.tv>
** Copyright (C) 2011 Matt Butcher
**
** Permission is hereby granted, free of charge, to any person obtaining a copy
** of this software and associated documentation files (the "Software"), to deal
** in the Software without restriction, including without limitation the rights
** to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
** copies of the Software, and to permit persons to whom the Software is
** furnished to do so, subject to the following conditions:
** 
** The above copyright notice and this permission notice shall be included in
** all copies or substantial portions of the Software.
** 
** THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
** IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
** FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
** AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
** LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
** OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
** THE SOFTWARE.
*/

var util = require('util');
var Stream = require('stream');
var Buffer = require('buffer').Buffer;

function StringReader(str, encoding) {
    this.data = str;
    this.encoding = encoding || this.encoding;
}
util.inherits(StringReader, Stream);
module.exports = StringReader;

StringReader.prototype.open =
StringReader.prototype.resume = function () {
    if (this.encoding && Buffer.isBuffer(this.data)) {
        this.emit('data', this.data.toString(this.encoding));
    }
    else {
        this.emit('data', this.data);
    }
    this.emit('end');
    this.emit('close');
}

StringReader.prototype.setEncoding = function (encoding) {
    this.encoding = encoding;
}


StringReader.prototype.pause = function () {
}

StringReader.prototype.destroy = function () {
    delete this.data;
}