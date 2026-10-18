import { getKokoroVoice } from './voices.js';
import {
  clampSpeechConcurrency,
  DEFAULT_SPEECH_CONCURRENCY,
  MAX_SPEECH_CONCURRENCY,
} from './scheduler.js';

const aborted = () => new DOMException('Speech stopped.', 'AbortError');
const timeoutError = () => new Error('Speech operation timed out. Retry loading the model.');

/**
 * Each Kokoro slot is its own worker and its own ONNX session. One session
 * cannot run two inferences; Transformers.js also serializes inference inside
 * a single worker. Parallel read-aloud loads N copies of the model instead of
 * queueing sentences on one session.
 */

/** Lazy host-owned worker RPC; no models or runtime imports on page entry. */
export function createSpeechRuntime({
  createWorker = (kind) =>
    kind === 'vad'
      ? new Worker(new URL('../../workers/vad-worker.js', import.meta.url), { type: 'module' })
      : new Worker(new URL('../../workers/speech-worker.js', import.meta.url), { type: 'module' }),
} = {}) {
  const engines = new Map();
  const kokoro = {
    target: DEFAULT_SPEECH_CONCURRENCY,
    activated: false,
    voiceId: null,
    remote: false,
    slots: [],
    queue: [],
  };
  let sequence = 0;

  function detach(job) {
    if (!job) return;
    if (job.timeout) clearTimeout(job.timeout);
    job.timeout = null;
    if (job.cancel) {
      job.signal?.removeEventListener('abort', job.cancel);
      job.cancel = null;
    }
    job.unwait?.();
    job.unwait = null;
  }
  function rejectJob(job, reason) {
    if (!job || job.settled) return;
    job.settled = true;
    detach(job);
    job.reject(reason);
  }
  function bindAbort(job) {
    if (!job.signal || job.cancel) return;
    job.cancel = () => abortJob(job);
    job.signal.addEventListener('abort', job.cancel, { once: true });
  }
  function release(kind, reason = aborted()) {
    const engine = engines.get(kind);
    if (!engine) return;
    engines.delete(kind);
    engine.worker.terminate();
    const jobs = [];
    if (engine.pending) jobs.push(engine.pending);
    jobs.push(...engine.queue);
    engine.pending = null;
    engine.queue = [];
    for (const job of jobs) rejectJob(job, reason);
  }
  function pump(kind) {
    const engine = engines.get(kind);
    if (!engine || engine.pending) return;
    while (engine.queue.length) {
      const job = engine.queue.shift();
      if (job.signal?.aborted) {
        rejectJob(job, aborted());
        continue;
      }
      const id = ++sequence;
      job.id = id;
      job.timeout = setTimeout(
        () => {
          if (engines.get(kind)?.pending === job) release(kind, timeoutError());
        },
        job.method === 'load' ? 300000 : 120000,
      );
      job.cancel = () => {
        if (engines.get(kind) === engine) release(kind);
      };
      job.signal?.addEventListener('abort', job.cancel, { once: true });
      engine.pending = job;
      try {
        engine.worker.postMessage({ id, method: job.method, args: job.args }, job.transfer);
      } catch (error) {
        engine.pending = null;
        rejectJob(job, error);
        if (job.method !== 'synthesize') {
          release(kind, error);
          return;
        }
        continue;
      }
      return;
    }
  }
  function finish(kind, job, error, value) {
    const engine = engines.get(kind);
    if (!engine || engine.pending !== job || job.settled) return;
    job.settled = true;
    detach(job);
    engine.pending = null;
    if (error) job.reject(error);
    else job.resolve(value);
    if (error && job.method !== 'synthesize') release(kind, error);
    else pump(kind);
  }
  function engineFor(kind) {
    if (engines.has(kind)) return engines.get(kind);
    const worker = createWorker(kind);
    const engine = { worker, loaded: false, pending: null, queue: [] };
    engines.set(kind, engine);
    worker.onerror = (event) => {
      if (engines.get(kind) === engine)
        release(kind, new Error(event.message || 'Speech worker failed.'));
    };
    worker.onmessage = ({ data }) => {
      const pending = engine.pending;
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'progress') {
        pending.onProgress?.(data.value);
        return;
      }
      if (data.type === 'error')
        finish(
          kind,
          pending,
          Object.assign(new Error(data.value.message), { name: data.value.name }),
        );
      else finish(kind, pending, null, data.value);
    };
    return engine;
  }
  function call(kind, method, args, { signal, onProgress } = {}, transfer = []) {
    if (signal?.aborted) return Promise.reject(aborted());
    const engine = engineFor(kind);
    const depth = (engine.pending ? 1 : 0) + engine.queue.length;
    if (depth >= MAX_SPEECH_CONCURRENCY)
      return Promise.reject(
        new Error('Speech is already preparing the maximum number of sentences.'),
      );
    return new Promise((resolve, reject) => {
      engine.queue.push({
        method,
        args,
        transfer,
        signal,
        onProgress,
        resolve,
        reject,
        settled: false,
      });
      pump(kind);
    });
  }

  function activeSlots() {
    return kokoro.slots.filter((slot) => !slot.retiring && !slot.released);
  }
  function wake(slot) {
    const waiters = slot.idleWaiters || [];
    slot.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
  function releaseSlot(slot, reason = aborted()) {
    if (slot.released) return;
    slot.released = true;
    slot.retiring = true;
    const job = slot.pending;
    slot.pending = null;
    if (job?.timeout) clearTimeout(job.timeout);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    try {
      slot.worker.terminate();
    } catch {
      /* already terminated */
    }
    kokoro.slots = kokoro.slots.filter((item) => item !== slot);
    if (job && !job.settled) rejectJob(job, reason);
    else detach(job);
    wake(slot);
  }
  function failSlot(slot, error) {
    if (slot.released) return;
    const job = slot.pending;
    slot.pending = null;
    if (job && !job.settled) rejectJob(job, error);
    const loadedLeft = kokoro.slots.some(
      (item) => item !== slot && item.loaded && !item.retiring && !item.released,
    );
    releaseSlot(slot);
    if (!loadedLeft) {
      const queued = kokoro.queue.splice(0);
      for (const waiting of queued) rejectJob(waiting, error);
      return;
    }
    dispatchKokoro();
  }
  function combinedProgress() {
    const active = activeSlots();
    const total = Math.max(kokoro.target, active.length, 1);
    const ready = active.filter((slot) => slot.loaded && slot.voiceId === kokoro.voiceId).length;
    const percent =
      active.reduce(
        (sum, slot) => sum + (slot.loaded ? 100 : Number(slot.progress?.percent) || 0),
        0,
      ) / total;
    const current = active.find((slot) => !slot.loaded);
    const detail = current?.progress?.text;
    let cacheAvailable;
    for (const slot of active) {
      const available = slot.cacheAvailable ?? slot.progress?.cacheAvailable;
      if (available === false) {
        cacheAvailable = false;
        break;
      }
      if (available != null) cacheAvailable = available;
    }
    return {
      text: detail
        ? `Voice model ${Math.min(ready + 1, total)} of ${total}: ${detail}`
        : `Voice model ${Math.min(ready + 1, total)} of ${total}`,
      percent,
      ...(cacheAvailable != null ? { cacheAvailable } : {}),
    };
  }
  function finishSlot(slot, job, error, value) {
    if (slot.released || slot.pending !== job) return;
    slot.pending = null;
    if (job.timeout) clearTimeout(job.timeout);
    job.timeout = null;
    job.signal?.removeEventListener('abort', job.cancel);
    if (!job.settled) {
      job.settled = true;
      if (error) job.reject(error);
      else job.resolve(value);
    }
    if (slot.retiring || (error && job.method !== 'synthesize')) {
      releaseSlot(slot);
      dispatchKokoro();
      return;
    }
    wake(slot);
    dispatchKokoro();
  }
  function createKokoroSlot() {
    const worker = createWorker('kokoro');
    const slot = {
      worker,
      loaded: false,
      voiceId: null,
      pending: null,
      retiring: false,
      released: false,
      progress: null,
      cacheAvailable: null,
      inflightLoad: null,
      inflightVoice: null,
      idleWaiters: [],
    };
    worker.onerror = (event) => {
      if (!slot.released) failSlot(slot, new Error(event.message || 'Speech worker failed.'));
    };
    worker.onmessage = ({ data }) => {
      const pending = slot.pending;
      if (!pending || data.id !== pending.id || slot.released) return;
      if (data.type === 'progress') {
        pending.onProgress?.(data.value);
        return;
      }
      if (data.type === 'error')
        finishSlot(
          slot,
          pending,
          Object.assign(new Error(data.value.message), { name: data.value.name }),
        );
      else finishSlot(slot, pending, null, data.value);
    };
    kokoro.slots.push(slot);
    return slot;
  }
  function ensureKokoroSlots() {
    while (activeSlots().length < kokoro.target) createKokoroSlot();
    for (const slot of activeSlots().slice(kokoro.target)) {
      slot.retiring = true;
      if (!slot.pending) releaseSlot(slot);
    }
  }
  function startJob(slot, job) {
    if (job.settled || slot.released) return;
    if (job.signal?.aborted) {
      rejectJob(job, aborted());
      return;
    }
    const id = ++sequence;
    job.id = id;
    job.slot = slot;
    slot.pending = job;
    job.timeout = setTimeout(
      () => {
        if (slot.pending === job && !slot.released) failSlot(slot, timeoutError());
      },
      job.method === 'load' || job.method === 'loadVoice' ? 300000 : 120000,
    );
    try {
      slot.worker.postMessage({ id, method: job.method, args: job.args }, job.transfer || []);
    } catch (error) {
      slot.pending = null;
      rejectJob(job, error);
      if (job.method !== 'synthesize') releaseSlot(slot, error);
      else dispatchKokoro();
    }
  }
  function waitForIdle(slot, job) {
    if (!slot.pending) return Promise.resolve();
    return new Promise((resolve) => {
      const resume = () => {
        job.unwait = null;
        resolve();
      };
      job.unwait = () => {
        slot.idleWaiters = (slot.idleWaiters || []).filter((waiter) => waiter !== resume);
      };
      slot.idleWaiters = slot.idleWaiters || [];
      slot.idleWaiters.push(resume);
    });
  }
  function abortJob(job) {
    job.unwait?.();
    const poolIndex = kokoro.queue.indexOf(job);
    if (poolIndex >= 0) kokoro.queue.splice(poolIndex, 1);
    const slot = job.slot;
    if (job.settled) return;
    const keepSession =
      slot && slot.pending === job && job.method === 'synthesize' && slot.loaded && !slot.released;
    job.settled = true;
    job.signal?.removeEventListener('abort', job.cancel);
    job.reject(aborted());
    if (keepSession) return;
    if (job.timeout) clearTimeout(job.timeout);
    job.timeout = null;
    if (slot?.pending === job) {
      slot.pending = null;
      releaseSlot(slot);
      dispatchKokoro();
    }
  }
  function callSlot(slot, method, args, { signal, onProgress } = {}, transfer = []) {
    if (signal?.aborted || slot.released) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const job = {
        method,
        args,
        transfer,
        signal,
        onProgress,
        resolve,
        reject,
        settled: false,
        slot: null,
      };
      bindAbort(job);
      const attempt = () => {
        if (job.settled) return;
        if (slot.released || slot.retiring) {
          rejectJob(job, aborted());
          return;
        }
        if (slot.pending) {
          waitForIdle(slot, job).then(attempt);
          return;
        }
        startJob(slot, job);
      };
      attempt();
    });
  }
  function loadKokoroSlot(slot, voiceId, options = {}) {
    if (slot.released || slot.retiring) return Promise.reject(aborted());
    if (slot.loaded && slot.voiceId === voiceId)
      return Promise.resolve({ cacheAvailable: slot.cacheAvailable });
    if (slot.inflightLoad) {
      if (slot.inflightVoice === voiceId) return slot.inflightLoad;
      return slot.inflightLoad.then(
        () => loadKokoroSlot(slot, voiceId, options),
        () => loadKokoroSlot(slot, voiceId, options),
      );
    }
    const task = (async () => {
      while (slot.pending && !slot.released && !slot.retiring) await waitForIdle(slot, {});
      if (slot.released || slot.retiring) throw aborted();
      if (slot.loaded && slot.voiceId === voiceId) return { cacheAvailable: slot.cacheAvailable };
      const method = slot.loaded ? 'loadVoice' : 'load';
      const args =
        method === 'load'
          ? { kind: 'kokoro', remote: options.remote === true, voiceId }
          : { voiceId };
      const result = await callSlot(slot, method, args, {
        signal: options.signal,
        onProgress: (progress) => {
          slot.progress = progress;
          if (progress?.cacheAvailable != null) slot.cacheAvailable = progress.cacheAvailable;
          options.onProgress?.(combinedProgress());
        },
      });
      if (slot.released) throw aborted();
      slot.loaded = true;
      slot.voiceId = voiceId;
      if (result?.cacheAvailable != null) slot.cacheAvailable = result.cacheAvailable;
      slot.progress = { text: 'Ready', percent: 100, cacheAvailable: slot.cacheAvailable };
      if (slot.retiring) {
        releaseSlot(slot);
        return result;
      }
      dispatchKokoro();
      return result;
    })().finally(() => {
      if (slot.inflightLoad === task) slot.inflightLoad = null;
    });
    slot.inflightVoice = voiceId;
    slot.inflightLoad = task;
    return task;
  }
  function dispatchKokoro() {
    for (const slot of kokoro.slots) {
      if (slot.retiring || slot.released || slot.pending || !slot.loaded) continue;
      const index = kokoro.queue.findIndex(
        (job) => !job.settled && job.method === 'synthesize' && job.args.voiceId === slot.voiceId,
      );
      if (index < 0) continue;
      const job = kokoro.queue.splice(index, 1)[0];
      if (job.signal?.aborted) {
        rejectJob(job, aborted());
        continue;
      }
      startJob(slot, job);
    }
  }
  function ensureKokoroCapacity(voiceId) {
    if (!kokoro.activated || !voiceId) return;
    ensureKokoroSlots();
    for (const slot of activeSlots()) {
      if (!slot.loaded || slot.voiceId !== voiceId)
        loadKokoroSlot(slot, voiceId, { remote: kokoro.remote }).catch(() => {});
    }
  }
  function synthesizeDepth() {
    return (
      kokoro.queue.filter((job) => job.method === 'synthesize').length +
      kokoro.slots.filter((slot) => slot.pending?.method === 'synthesize').length
    );
  }
  function cancelKokoro() {
    const queued = kokoro.queue.splice(0);
    for (const job of queued) rejectJob(job, aborted());
    for (const slot of [...kokoro.slots]) {
      const job = slot.pending;
      if (!job) continue;
      if (!job.settled) {
        job.settled = true;
        job.signal?.removeEventListener('abort', job.cancel);
        job.reject(aborted());
      }
      if (job.method === 'synthesize' && slot.loaded) continue;
      if (job.timeout) clearTimeout(job.timeout);
      slot.pending = null;
      releaseSlot(slot);
    }
  }
  function disposeKokoro() {
    const queued = kokoro.queue.splice(0);
    for (const job of queued) rejectJob(job, aborted());
    for (const slot of [...kokoro.slots]) releaseSlot(slot);
    kokoro.activated = false;
    kokoro.voiceId = null;
  }
  async function loadSingle(kind, options) {
    const result = await call(kind, 'load', { kind, remote: options?.remote === true }, options);
    if (options?.signal?.aborted) throw aborted();
    const engine = engines.get(kind);
    if (!engine) throw aborted();
    engine.loaded = true;
    return result;
  }
  async function loadKokoro(options = {}) {
    const voiceId = options.voiceId || 'af_heart';
    getKokoroVoice(voiceId);
    if (options.signal?.aborted) throw aborted();
    kokoro.activated = true;
    kokoro.voiceId = voiceId;
    if (options.remote != null) kokoro.remote = options.remote === true;
    ensureKokoroSlots();
    const ready = async () => {
      const pending = activeSlots().filter((slot) => !slot.loaded || slot.voiceId !== voiceId);
      if (!pending.length) return;
      await Promise.all(pending.map((slot) => loadKokoroSlot(slot, voiceId, options)));
    };
    await ready();
    await ready();
    if (options.signal?.aborted) throw aborted();
    const loaded = activeSlots().filter((slot) => slot.loaded && slot.voiceId === voiceId);
    if (loaded.length < kokoro.target) throw new Error('Neural voice did not load every copy.');
    const flags = loaded.map((slot) => slot.cacheAvailable).filter((value) => value != null);
    return { cacheAvailable: flags.length ? flags.every(Boolean) : undefined };
  }
  function setKokoroSessions(value) {
    const next = clampSpeechConcurrency(value);
    kokoro.target = next;
    if (!kokoro.activated) return Promise.resolve(next);
    ensureKokoroSlots();
    const loads = [];
    if (kokoro.voiceId) {
      for (const slot of activeSlots()) {
        if (!slot.loaded || slot.voiceId !== kokoro.voiceId)
          loads.push(loadKokoroSlot(slot, kokoro.voiceId, { remote: kokoro.remote }));
      }
    }
    dispatchKokoro();
    return Promise.all(loads).then(() => next);
  }

  return {
    get kokoroSessionCount() {
      return kokoro.target;
    },
    get kokoroPoolReady() {
      return (
        activeSlots().filter((slot) => slot.loaded && slot.voiceId === kokoro.voiceId).length >=
        kokoro.target
      );
    },
    setKokoroSessions,
    isLoaded: (kind) =>
      kind === 'kokoro'
        ? kokoro.slots.some((slot) => slot.loaded && !slot.retiring && !slot.released)
        : !!engines.get(kind)?.loaded,
    isVoiceLoaded: (voiceId = 'af_heart') => {
      const active = kokoro.slots.filter((slot) => slot.loaded && !slot.retiring && !slot.released);
      return active.length > 0 && active.every((slot) => slot.voiceId === voiceId);
    },
    async load(kind, options) {
      if (kind === 'kokoro') return loadKokoro(options);
      return loadSingle(kind, options);
    },
    transcribe(audio, options) {
      return call('whisper', 'transcribe', { audio }, options, [audio.buffer]);
    },
    synthesize(text, options) {
      const voiceId = options?.voiceId || 'af_heart';
      getKokoroVoice(voiceId);
      if (options?.signal?.aborted) return Promise.reject(aborted());
      ensureKokoroCapacity(voiceId);
      if (!kokoro.slots.some((slot) => slot.loaded && !slot.retiring && !slot.released))
        return Promise.reject(new Error('Load Neural voice first.'));
      if (synthesizeDepth() >= MAX_SPEECH_CONCURRENCY)
        return Promise.reject(
          new Error('Speech is already preparing the maximum number of sentences.'),
        );
      return new Promise((resolve, reject) => {
        const job = {
          method: 'synthesize',
          args: { text, voiceId },
          signal: options?.signal,
          resolve,
          reject,
          settled: false,
          slot: null,
        };
        bindAbort(job);
        kokoro.queue.push(job);
        dispatchKokoro();
      });
    },
    resetVad(options) {
      return call('vad', 'reset', {}, options);
    },
    detectSpeech(frame, options) {
      return call('vad', 'frame', { frame }, options, [frame.buffer]);
    },
    cancel() {
      for (const [kind, engine] of engines)
        if (engine.pending || engine.queue.length) release(kind);
      cancelKokoro();
    },
    dispose() {
      for (const kind of [...engines.keys()]) release(kind);
      disposeKokoro();
    },
  };
}
