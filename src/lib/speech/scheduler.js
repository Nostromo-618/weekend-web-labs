/** How many Kokoro sessions may synthesize at once. Hard-capped below. */
export const DEFAULT_SPEECH_CONCURRENCY = 2;
export const MAX_SPEECH_CONCURRENCY = 8;

export function clampSpeechConcurrency(value = DEFAULT_SPEECH_CONCURRENCY) {
  const count =
    typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
  if (!Number.isInteger(count)) return DEFAULT_SPEECH_CONCURRENCY;
  return Math.min(MAX_SPEECH_CONCURRENCY, Math.max(1, count));
}

/**
 * Synthesize sentences with one in-flight call per live Kokoro session and hand
 * them to playback in order. A later sentence that finishes early is held until
 * the ones before it have been delivered. Aborting drops anything not yet
 * delivered, including audio that already finished synthesizing. A failed
 * sentence is reported and does not stop the rest of the pool.
 *
 * `concurrency` is the user's session count (default 2, never more than 8):
 * how many `synthesize` calls may run at once, each on its own ONNX session.
 * It is not a queue depth on one session, and it does not wait for playback of
 * sentence N before starting sentence N+1.
 */
export async function scheduleSpeechSentences({
  sentences,
  synthesize,
  concurrency = DEFAULT_SPEECH_CONCURRENCY,
  signal,
  onSentence,
}) {
  const limit = clampSpeechConcurrency(concurrency);
  const list = Array.isArray(sentences) ? sentences : [];
  const outcomes = new Array(list.length);
  let nextStart = 0;
  let inFlight = 0;
  let nextPlay = 0;
  let stopped = signal?.aborted === true;
  let playbackError = null;
  let resolveWait = () => {};
  let waiting = new Promise((resolve) => {
    resolveWait = resolve;
  });

  const pulse = () => {
    const resolve = resolveWait;
    waiting = new Promise((next) => {
      resolveWait = next;
    });
    resolve();
  };
  const onAbort = () => {
    stopped = true;
    pulse();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const startMore = () => {
    while (!stopped && inFlight < limit && nextStart < list.length) {
      const index = nextStart;
      nextStart += 1;
      inFlight += 1;
      const sentence = list[index];
      let task;
      try {
        task = synthesize(sentence, index);
      } catch (error) {
        task = Promise.reject(error);
      }
      Promise.resolve(task)
        .then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        )
        .then((outcome) => {
          inFlight -= 1;
          outcomes[index] = stopped ? { dropped: true } : outcome;
          if (!stopped) startMore();
          pulse();
        });
    }
  };

  try {
    startMore();
    while (nextPlay < list.length && !stopped) {
      const outcome = outcomes[nextPlay];
      if (!outcome) {
        if (inFlight === 0 && nextStart >= list.length) break;
        const pending = waiting;
        if (!outcomes[nextPlay] && !stopped) await pending;
        continue;
      }
      if (outcome.dropped) break;
      if (!outcome.ok && outcome.error?.name === 'AbortError') {
        stopped = true;
        break;
      }
      const index = nextPlay;
      nextPlay += 1;
      try {
        await onSentence(index, list[index], outcome);
      } catch (error) {
        stopped = true;
        playbackError = error;
        break;
      }
      if (stopped || signal?.aborted) break;
    }
  } finally {
    stopped = true;
    signal?.removeEventListener('abort', onAbort);
    pulse();
  }
  if (playbackError) throw playbackError;
  return { started: nextStart, delivered: nextPlay };
}
