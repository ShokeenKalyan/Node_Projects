
/** 
const cluster = require('cluster');
const os      = require('os');

if (cluster.isPrimary) {
  // Spawn one worker per CPU core
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) cluster.fork();

  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.id} died — restarting`);
    cluster.fork();  // auto-restart on crash
  });
} else {
  // Each worker runs the full Express app
  const app = require('./app');
  app.listen(3000);
  console.log(`Worker ${process.pid} started`);
}
*/

/** 

// main.ts — hand CPU work to a worker thread
import { Worker } from 'worker_threads';

function runInWorker<T>(workerPath: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: data });
    worker.on('message', resolve);
    worker.on('error',   reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited: ${code}`));
    });
  });
}

// worker.ts — runs in a separate thread
import { workerData, parentPort } from 'worker_threads';
// Do expensive CPU work here — won't block main thread
const result = expensiveComputation(workerData);
parentPort!.postMessage(result);

*/