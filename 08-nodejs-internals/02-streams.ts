
import fs from 'fs';
import zlib from 'zlib';
import { Readable, Writable } from 'stream';

const readable = Readable.from(['Hello, ', 'world!']); 
const writable = new Writable({
  write(chunk, encoding, callback) {
    console.log(chunk.toString());
    callback();
  }
});


// BAD — ignores backpressure, buffers entire file in memory
readable.on('data', (chunk) => {
  writable.write(chunk);  // write() returns false when buffer is full
                          // but we keep calling it anyway — memory leak
});

// GOOD — pipe handles backpressure automatically
readable.pipe(writable);

// BEST — pipeline cleans up on error too (Node 10+)
const { pipeline } = require('stream/promises');
(async () => {
  await pipeline(
    fs.createReadStream('input.txt'),
    zlib.createGzip(),
    fs.createWriteStream('output.gz')
  ); // destroys all streams on error/completion
})();


// Manual backpressure with drain event

// When write() returns false — pause the source
readable.on('data', (chunk) => {
  const canContinue = writable.write(chunk);
  if (!canContinue) {
    readable.pause();                   // stop reading
    writable.once('drain', () => {
      readable.resume();                // writable drained — resume
    });
  }
});