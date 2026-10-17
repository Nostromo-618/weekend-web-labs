import { dependencies } from '../../package.json';
import { collectDeviceSignals, MODEL_OPTIONS } from '@wwl/wwl-ai-chat';
import { loadTransformers } from './transformers-chat.js';
import { publicUrl } from './public-url.js';
/** Labs owns injected runtimes; report installed versions rather than catalog defaults. */
export function getChatRuntimeVersion(model) {
  const name = {
    transformers: '@huggingface/transformers',
    litert: '@litert-lm/core',
    webllm: '@mlc-ai/web-llm',
  }[model?.backend];
  return dependencies[name] || model?.runtimeVersion || null;
}
/** Bundled runtime adapters. Model weights download only after a user's Load action. */
const ownedConfigs = new Map();
function localConfig(base) {
  return {
    ...base,
    model_list: base.model_list.map((record) => ({
      ...record,
      model_lib: MODEL_OPTIONS.some((m) => m.id === record.model_id && m.backend === 'webllm')
        ? new URL(publicUrl(`webllm-wasm/${record.model_id}.wasm`), location.href).href
        : record.model_lib,
    })),
  };
}
export async function loadWebLLM() {
  const mod = await import('@mlc-ai/web-llm');
  return {
    ...mod,
    async CreateMLCEngine(modelId, options = {}) {
      const { signal, ...engineOptions } = options;
      if (signal?.aborted) throw new DOMException('Model loading stopped.', 'AbortError');
      const worker = new Worker(new URL('../workers/webllm-worker.js', import.meta.url), {
        type: 'module',
      });
      const base = engineOptions.appConfig || mod.prebuiltAppConfig;
      const appConfig = localConfig(base);
      ownedConfigs.set(modelId, appConfig);
      let onError;
      let onAbort;
      const workerFailed = new Promise((_, reject) => {
        onError = (event) =>
          reject(
            new Error(event.message || 'The model worker could not start. Reload and try again.'),
          );
        worker.addEventListener('error', onError);
      });
      const aborted = new Promise((_, reject) => {
        onAbort = () => {
          worker.terminate();
          reject(new DOMException('Model loading stopped.', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const loading = mod.CreateWebWorkerMLCEngine(worker, modelId, {
        ...engineOptions,
        appConfig,
      });
      try {
        const engine = await Promise.race([workerFailed, aborted, loading]);
        engine.terminateWorker = () => worker.terminate();
        return trackEngine(engine, 'unload');
      } catch (error) {
        worker.terminate();
        void loading.then(
          (engine) => engine?.unload?.(),
          () => {},
        );
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        worker.removeEventListener('error', onError);
      }
    },
  };
}
export const activeEngines = new Set();
function trackEngine(engine, method) {
  activeEngines.add(engine);
  const release = engine[method].bind(engine);
  engine[method] = async (...args) => {
    try {
      return await release(...args);
    } finally {
      activeEngines.delete(engine);
    }
  };
  return engine;
}
export async function getChatDeviceCapabilities() {
  const gpu = globalThis.navigator?.gpu;
  let adapter = null;
  try {
    adapter = await gpu?.requestAdapter();
  } catch {
    /* unavailable */
  }
  return {
    ...collectDeviceSignals(adapter),
    webgpuSupported: Boolean(adapter),
    shaderF16: Boolean(adapter?.features?.has?.('shader-f16')),
  };
}
export const chatRuntimeOptions = {
  loadLiteRT: async () => {
    const mod = await import('@litert-lm/core');
    return {
      ...mod,
      Engine: {
        create: async (...args) => trackEngine(await mod.Engine.create(...args), 'delete'),
      },
    };
  },
  loadWebLLM,
  loadTransformers: async () => {
    const runtime = await loadTransformers();
    return {
      createEngine: async (...args) => trackEngine(await runtime.createEngine(...args), 'dispose'),
    };
  },
  liteRtWasmPath: publicUrl('litert-wasm/'),
};

/** Exact chat-owned cache names and model identities; never scan unrelated databases. */
export async function clearChatCaches(modelIds = MODEL_OPTIONS.map((m) => m.id)) {
  const selectedIds = new Set(modelIds);
  const { LITERT_MODEL_CACHE_NAME } = await import('@wwl/wwl-ai-chat');
  if (activeEngines.size) throw new Error('Unload chat models before clearing their cache.');
  const selectedModels = MODEL_OPTIONS.filter((m) => selectedIds.has(m.id));
  for (const name of [LITERT_MODEL_CACHE_NAME, 'wwl-chat-onnx-v1']) {
    try {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (
          selectedModels.some(
            (m) =>
              request.url.includes(m.repo || '!no-repo!') ||
              (m.modelFile && request.url.endsWith('/' + m.modelFile)) ||
              request.url.includes('/models/' + m.id + '/'),
          )
        )
          await cache.delete(request);
      }
    } catch {
      /* Storage unavailable: no cache to clear. */
    }
  }
  for (const id of selectedIds) {
    try {
      localStorage.removeItem('wwl-ai-chat-model-cached:' + id);
    } catch {
      /* storage denied */
    }
  }
  const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  const ids = new Set(
    MODEL_OPTIONS.filter((m) => m.backend === 'webllm' && selectedIds.has(m.id)).flatMap((m) =>
      [m.id, m.fallbackId].filter(Boolean),
    ),
  );
  for (const record of prebuiltAppConfig.model_list.filter((m) => ids.has(m.model_id))) {
    await deleteModelAllInfoInCache(record.model_id, prebuiltAppConfig);
    await deleteModelAllInfoInCache(record.model_id, localConfig(prebuiltAppConfig));
  }
  for (const [id, config] of ownedConfigs)
    if (selectedIds.has(id)) await deleteModelAllInfoInCache(id, config);
  for (const model of MODEL_OPTIONS.filter(
    (m) => selectedIds.has(m.id) && m.backend === 'webllm' && m.modelUrl && m.modelLibUrl,
  )) {
    await deleteModelAllInfoInCache(model.id, {
      model_list: [{ model_id: model.id, model: model.modelUrl, model_lib: model.modelLibUrl }],
    });
  }
}
