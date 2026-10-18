import {
  pipeline,
  env,
  AutoTokenizer,
  StyleTextToSpeech2Model,
  Tensor,
} from '@huggingface/transformers';
import { SPEECH_MODELS, assetURL, openSpeechCache } from '../lib/speech/assets.js';
import { getKokoroVoice, verifyVoiceBytes } from '../lib/speech/voices.js';
import { splitSpeechTokens } from '../lib/speech/text.js';
import { publicUrl } from '../lib/public-url.js';

env.backends.onnx.wasm.wasmPaths = publicUrl('transformers-wasm/');
env.backends.onnx.wasm.numThreads = 1;
env.useBrowserCache = false;
env.allowLocalModels = false;
env.useCustomCache = true;
let kind, cache, transcriber, model, tokenizer, voiceData, phonemize, modelSource, selectedVoice;

async function sourceFor(spec, remote) {
  if (!remote && (import.meta.env.DEV || import.meta.env.MODE === 'qa')) {
    const base = `/models/wwl-speech-${kind}/`;
    const marker = new URL(base + '.labs-model.json', self.location.href).href;
    let response = await cache.match(marker);
    if (!response) {
      try {
        response = await fetch(marker);
      } catch {
        /* no mirror available */
      }
      if (response?.ok && !response.headers.get('content-type')?.includes('text/html'))
        await cache.put(marker, response.clone());
    }
    if (response?.ok && !response.headers.get('content-type')?.includes('text/html')) {
      if ((await response.json()).revision !== spec.revision)
        throw new Error('Local speech model revision differs. Refresh speech model files.');
      env.allowLocalModels = true;
      return base;
    }
  }
  return spec.repo;
}

async function load(args, progress) {
  kind = args.kind;
  const spec = SPEECH_MODELS[kind];
  if (!spec) throw new Error('Unknown speech model.');
  // Earlier Transformers 4.2 metadata/tokenizer discovery omitted options.revision in
  // several internal calls. Pin this worker's template too, so discovery and
  // inference use the same immutable assets and can find them offline.
  env.remotePathTemplate = `{model}/resolve/${spec.revision}/`;
  cache = await openSpeechCache(`wwl-speech-${kind}-v1`);
  env.customCache = cache;
  progress({
    text: cache.available
      ? 'Preparing local speech model…'
      : 'Storage unavailable; this load will not be cached.',
    cacheAvailable: cache.available,
  });
  const source = await sourceFor(spec, args.remote);
  const options = {
    revision: spec.revision,
    device: 'wasm',
    dtype: 'q8',
    // Keep the graph-optimization workaround for the pinned Whisper decoder's QDQ
    // embedding scales. Keep its original graph; Kokoro retains optimization.
    ...(kind === 'whisper' ? { session_options: { graphOptimizationLevel: 'disabled' } } : {}),
    progress_callback: (p) =>
      progress({ text: p.file || p.status, percent: p.progress, loaded: p.loaded, total: p.total }),
  };
  if (kind === 'whisper') {
    transcriber = await pipeline('automatic-speech-recognition', source, options);
  } else {
    ({ phonemize } = await import('../lib/speech/kokoro-phonemize.js'));
    model = await StyleTextToSpeech2Model.from_pretrained(source, options);
    tokenizer = await AutoTokenizer.from_pretrained(source, options);
    modelSource = source;
    await loadVoice(args.voiceId);
  }
  return { cacheAvailable: cache.available };
}

async function loadVoice(id = 'af_heart') {
  if (!model) throw new Error('Load Neural voice first.');
  const voice = getKokoroVoice(id);
  const spec = SPEECH_MODELS.kokoro;
  const source = modelSource;
  const url = source.startsWith('/') ? source + voice.path : assetURL(spec, voice.path);
  let response = await cache.match(url);
  if (!response) {
    try {
      response = await fetch(url);
      if (!response.ok && source.startsWith('/'))
        response = await fetch(assetURL(spec, voice.path));
      if (!response.ok) throw new Error('Voice asset unavailable.');
    } catch {
      throw new Error(
        'Selected neural voice is unavailable. Load this voice while online, then retry.',
      );
    }
  }
  const bytes = await response.arrayBuffer();
  await verifyVoiceBytes(bytes, voice);
  await cache.put(url, new globalThis.Response(bytes));
  voiceData = new Float32Array(bytes);
  selectedVoice = voice;
  return { cacheAvailable: cache.available, voiceId: voice.id };
}

async function synthesize(text, voiceId = 'af_heart') {
  if (!model) throw new Error('Load Neural voice first.');
  if (!text || text.length > 1000) throw new Error('Speech sentence is too long.');
  const voice = getKokoroVoice(voiceId);
  if (selectedVoice?.id !== voice.id)
    throw new Error('Load the selected neural voice before speaking.');
  const phonemes = await phonemize(text, voice.language);
  const encoded = tokenizer(phonemes, { truncation: false }).input_ids;
  const ids = Array.from(encoded.data);
  encoded.dispose();
  const separator = BigInt(tokenizer.encode(' ', { add_special_tokens: false })[0]);
  const chunks = [];
  for (const tokens of splitSpeechTokens(ids.slice(1, -1), separator)) {
    const data = BigInt64Array.from([ids[0], ...tokens, ids.at(-1)]);
    const input_ids = new Tensor('int64', data, [1, data.length]);
    const style = new Tensor(
      'float32',
      voiceData.slice(tokens.length * 256, (tokens.length + 1) * 256),
      [1, 256],
    );
    const speed = new Tensor('float32', [1], [1]);
    let waveform;
    try {
      // This worker owns one ONNX session. A second session.run on it throws
      // "Session already started". Parallel copies are separate workers.
      ({ waveform } = await model({ input_ids, style, speed }));
      chunks.push(waveform.data.slice());
    } finally {
      input_ids.dispose();
      style.dispose();
      speed.dispose();
      waveform?.dispose();
    }
  }
  return { chunks, sampleRate: 24000 };
}

// One chain per worker, because this module's ONNX session cannot overlap
// inferences. The host puts each parallel copy in its own worker. Cancelling
// a sentence drops its audio; terminating this worker is what releases the copy.
async function dispatch({ data: { id, method, args } }) {
  const progress = (value) => self.postMessage({ id, type: 'progress', value });
  try {
    let value;
    if (method === 'load') value = await load(args, progress);
    else if (method === 'transcribe') {
      if (!transcriber) throw new Error('Load dictation first.');
      if (!(args.audio instanceof Float32Array) || args.audio.length > 16000 * 60)
        throw new Error('Invalid recording duration.');
      let energy = 0;
      for (const sample of args.audio) energy += sample * sample;
      value =
        !args.audio.length || Math.sqrt(energy / args.audio.length) < 0.0005
          ? ''
          : (await transcriber(args.audio, { chunk_length_s: 30, stride_length_s: 5 })).text.trim();
    } else if (method === 'loadVoice') value = await loadVoice(args.voiceId);
    else if (method === 'synthesize') value = await synthesize(args.text, args.voiceId);
    else throw new Error('Unknown speech operation.');
    self.postMessage({ id, type: 'result', value }, value?.chunks?.map((pcm) => pcm.buffer) || []);
  } catch (error) {
    self.postMessage({ id, type: 'error', value: { name: error.name, message: error.message } });
  }
}
let chain = Promise.resolve();
self.onmessage = (event) => {
  chain = chain
    .then(() => dispatch(event))
    .then(
      () => {},
      () => {},
    );
};
