// Password hashing on background threads. bcrypt is deliberately slow (that is what makes stolen hashes hard to
// crack), and bcryptjs runs in JavaScript, so on the main thread a burst of sign-ins would stall every other request.
// A small pool of worker threads takes that work instead; if threads are unavailable it falls back to the main thread.
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const bcrypt = require('bcryptjs');

if (!isMainThread) {
  parentPort.on('message', ({ id, op, password, hash, rounds }) => {
    try {
      const result = op === 'compare' ? bcrypt.compareSync(password, hash) : bcrypt.hashSync(password, rounds);
      parentPort.postMessage({ id, result });
    } catch (err) {
      parentPort.postMessage({ id, error: err.message });
    }
  });
  return;
}

const SIZE = Math.max(1, Math.min(4, (os.availableParallelism?.() || os.cpus().length) - 1));
const workers = [];
const pending = new Map();
const queue = [];
let nextId = 1;
let disabled = false;

function spawn() {
  const w = new Worker(__filename);
  w.busy = false;
  w.on('message', ({ id, result, error }) => {
    const job = pending.get(id);
    pending.delete(id);
    w.busy = false;
    w.unref(); // idle workers never keep the process alive
    if (job) error ? job.reject(new Error(error)) : job.resolve(result);
    drain();
  });
  w.on('error', (err) => {
    console.error('[hasher] worker failed:', err.message);
    for (const [id, job] of pending) if (job.worker === w) (pending.delete(id), job.reject(err));
    workers.splice(workers.indexOf(w), 1);
  });
  w.unref();
  workers.push(w);
  return w;
}

function drain() {
  while (queue.length) {
    let w = workers.find((x) => !x.busy);
    if (!w && workers.length < SIZE) {
      try {
        w = spawn();
      } catch (err) {
        console.warn('[hasher] threads unavailable, hashing on the main thread:', err.message);
        disabled = true;
        for (const job of queue.splice(0)) runInline(job);
        return;
      }
    }
    if (!w) return;
    const job = queue.shift();
    w.busy = true;
    w.ref();
    job.worker = w;
    pending.set(job.id, job);
    w.postMessage({ id: job.id, ...job.msg });
  }
}

function runInline(job) {
  const p = job.msg.op === 'compare' ? bcrypt.compare(job.msg.password, job.msg.hash) : bcrypt.hash(job.msg.password, job.msg.rounds);
  p.then(job.resolve, job.reject);
}

function run(msg) {
  return new Promise((resolve, reject) => {
    const job = { id: nextId++, msg, resolve, reject };
    if (disabled) return runInline(job);
    queue.push(job);
    drain();
  });
}

const compare = (password, hash) => run({ op: 'compare', password: String(password), hash: String(hash) });
const hash = (password, rounds = 11) => run({ op: 'hash', password: String(password), rounds });

module.exports = { compare, hash };
