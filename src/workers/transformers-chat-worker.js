import {
  AutoTokenizer,
  AutoModelForCausalLM,
  Ministral3ForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
  env,
} from '@huggingface/transformers';
import { onnxTextLoadPlan } from '@wwl/wwl-ai-chat';
import { publicUrl } from '../lib/public-url.js';

env.backends.onnx.wasm.wasmPaths = publicUrl('transformers-wasm/');
env.backends.onnx.wasm.numThreads = 1;
env.useBrowserCache = false;
env.allowLocalModels = true;
env.useCustomCache = false;
const cacheSetup = Promise.race([
  Promise.resolve()
    .then(() => (typeof caches === 'undefined' ? null : caches.open('wwl-chat-onnx-v1')))
    .catch(() => null),
  new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
]).then((cache) => {
  if (!cache) return false;
  env.customCache = cache;
  env.useCustomCache = true;
  return true;
});
let tokenizer, model, option;
const stopping = new InterruptableStoppingCriteria();
const template = (messages) => {
  let chatTemplate = tokenizer.chat_template;
  if (option.family === 'lfm25' && typeof chatTemplate === 'string') {
    // Transformers.js 4.2's Jinja renderer lacks HF's generation-span extension.
    // Those tags annotate training labels; removing only the markers preserves inference text.
    chatTemplate = chatTemplate.replace(/\{%-?\s*(?:end)?generation\s*-?%\}/g, '');
  }
  return tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: false,
    ...(chatTemplate !== tokenizer.chat_template ? { chat_template: chatTemplate } : {}),
  });
};
const send = (id, type, value) => self.postMessage({ id, type, value });
self.onmessage = async ({ data: { id, method, args } }) => {
  if (method === 'cancel') {
    stopping.interrupt();
    return;
  }
  try {
    let result;
    if (method === 'load') {
      option = args.model;
      const source = args.source || option.repo;
      send(id, 'progress', {
        stage: 'downloading',
        text: 'Preparing local model runtime…',
        loaded: 0,
        source: args.source ? 'local' : 'runtime-managed',
      });
      await cacheSetup;
      const plan = onnxTextLoadPlan(option);
      const settings = {
        revision: option.revision,
        device: 'webgpu',
        dtype: plan.dtype,
        ...(plan.useExternalDataFormat == null
          ? {}
          : { use_external_data_format: plan.useExternalDataFormat }),
        progress_callback: (progress) => {
          const file = String(progress.file || '');
          if (plan.modelClass === 'Ministral3ForCausalLM' && file.includes('vision_encoder')) {
            throw new Error('Text-only Ministral load must not fetch the vision encoder.');
          }
          send(id, 'progress', {
            stage: progress.status === 'ready' ? 'compiling' : 'downloading',
            text: progress.file || progress.status,
            loaded: (progress.progress || 0) / 100,
            source: args.source ? 'local' : 'runtime-managed',
          });
        },
      };
      const modelClass =
        plan.modelClass === 'Ministral3ForCausalLM' ? Ministral3ForCausalLM : AutoModelForCausalLM;
      send(id, 'progress', {
        stage: 'downloading',
        text: 'Loading model tokenizer…',
        loaded: 0,
        source: args.source ? 'local' : 'runtime-managed',
      });
      tokenizer = await AutoTokenizer.from_pretrained(source, settings);
      send(id, 'progress', {
        stage: 'downloading',
        text: 'Loading ONNX model weights…',
        loaded: 0,
        source: args.source ? 'local' : 'runtime-managed',
      });
      model = await modelClass.from_pretrained(source, settings);
      result = true;
    } else if (method === 'countTokens') {
      result = tokenizer.encode(template(args.messages)).length;
    } else if (method === 'generate') {
      stopping.reset();
      const inputs = tokenizer(template(args.messages));
      // The 2.6B template supplies the opening think marker in the prompt.
      let text = option.reasoning === 'required' ? '<think>' : '';
      const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: false,
        callback_function: (token) => {
          text += token;
          send(id, 'update', text);
        },
      });
      const output = await model.generate({
        ...inputs,
        max_new_tokens: args.maxOutputTokens,
        do_sample: false,
        repetition_penalty: 1.05,
        streamer,
        stopping_criteria: stopping,
      });
      const inputTokens = inputs.input_ids.data.length;
      result = {
        reply: text.replace(/<\|im_end\|>|<\|endoftext\|>/g, ''),
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: output.data.length - inputTokens,
          total_tokens: output.data.length,
          includes_reasoning: option.reasoning === 'required',
        },
      };
      for (const tensor of Object.values(inputs)) tensor.dispose?.();
      output.dispose?.();
    } else if (method === 'reset') {
      stopping.reset();
      result = true;
    } else if (method === 'dispose') {
      await model?.dispose();
      model = null;
      tokenizer = null;
      result = true;
    } else throw new Error(`Unknown worker operation: ${method}`);
    send(id, 'result', result);
  } catch (error) {
    send(id, 'error', { name: error.name, message: error.message });
  }
};
