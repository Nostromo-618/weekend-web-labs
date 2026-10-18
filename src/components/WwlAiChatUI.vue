<script setup>
import WwlModelDetails from './WwlModelDetails.vue';
import WwlChatSpeech from './WwlChatSpeech.vue';
import { useChatWorkspace } from '../lib/chat-workspace.js';
import { useId } from 'vue';
import { readChatPreferences, saveChatPreferences } from '../lib/chat-preferences.js';
import { getKokoroVoice } from '../lib/speech/voices.js';
import { localEnglishVoices } from '../lib/speech/text.js';
import { SPEECH_MODELS } from '../lib/speech/assets.js';
import { clearSpeechCaches } from '../lib/speech/assets.js';
import { SpeechSession } from '../lib/speech/session.js';
import { ConversationSession } from '../lib/speech/conversation.js';
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VdButton, VdCard, VdIcon, VdModal, VdProgress, VdSpinner } from '@vanduo-oss/vd3';
import {
  AiChat,
  MODEL_GROUPS,
  MODEL_OPTIONS,
  PRIMARY_MODEL_OPTIONS,
  getModelVariants,
  getModelChoiceLabel,
  assessLoadCapacity,
  collectDeviceSignals,
  describeLoadProgress,
  getLiteRTRuntimeBlockReason,
  getModelDisplayName,
  getModelOption,
  shouldFocusChatComposer,
  SET_FLOWCHART_DOCUMENT,
  FLOWCHART_DRAW_FOLLOW_UP,
  FLOWCHART_TOOL_DESCRIPTION,
  FLOWCHART_TOOL_PARAMETERS,
  prepareFlowchartDocument,
  flowchartDrawNeedsFollowUp,
  validateFlowchartDocument,
  visionImagesForModel,
} from '@wwl/wwl-ai-chat';
import { validateLlmInput } from '@wwl/wwl-ai-chat/guardrails/llm';
import { toGuardrailError } from '@wwl/wwl-ai-chat';
import { chatRuntimeOptions, clearChatCaches } from '../lib/chat-runtime.js';
import { labsMarkdownToHtml } from '@wwl/wwl-ai-chat/markdown';

const MODEL_CACHE_FLAG_PREFIX = 'wwl-ai-chat-model-cached:';

const props = defineProps({
  chat: { type: Object, default: null },
  speechOptions: { type: Object, default: null },
  conversationOptions: { type: Object, default: null },
  flowchartDocument: { type: Object, default: null },
  captureFlowchart: { type: Function, default: null },
});
const emit = defineEmits(['model-change', 'flowchart-document', 'flowchart-rejected']);

/**
 * Inference engines (LiteRT / WebLLM WASM) must not live inside Vue reactivity
 * (Proxy breaks bindings) and only one runtime should exist per tab.
 * Keep the owned runtime outside Vue proxies and dispose it on exit.
 * @type {AiChat | null}
 */
let chat = null;

const preferences = ref(readChatPreferences());
const delivery = computed({
  get: () => preferences.value.delivery,
  set: (value) => updatePreferences({ delivery: value }),
});
const flowchartTools = computed(() => !!getModelOption(selectedModelId.value)?.capabilities?.tools);
function syncFlowchartTools() {
  if (!chat || streaming.value || typeof chat.registerTools !== 'function') return;
  if (!flowchartTools.value) {
    chat.registerTools([]);
    return;
  }
  chat.registerTools([
    {
      name: SET_FLOWCHART_DOCUMENT,
      description: FLOWCHART_TOOL_DESCRIPTION,
      parameters: FLOWCHART_TOOL_PARAMETERS,
    },
  ]);
}
async function executeFlowchartTool(name, args) {
  if (name !== SET_FLOWCHART_DOCUMENT) return { error: 'tool.name.not_allowed' };
  const prepared = prepareFlowchartDocument(args?.document);
  const check = validateFlowchartDocument(prepared);
  if (!check.allowed) {
    emit('flowchart-rejected', check.message);
    return { error: check.code, message: check.message };
  }
  emit('flowchart-document', prepared);
  return { ok: true };
}
function updatePreferences(patch) {
  preferences.value = { ...preferences.value, ...patch };
  saveChatPreferences(patch);
}
const previewText = ref(''),
  previewIndex = ref(-1);
const selectedModelId = ref(MODEL_OPTIONS[0].id);
const systemInfo = ref(null);
const loaded = ref(false);
const loading = ref(false);
const progressPct = ref(0);
const progressText = ref('');
const statusText = ref('Offline');
const statusTone = ref('muted');
const fallbackNote = ref('');
const cacheHint = ref('');
const inputText = ref('');
const messages = ref([]);
const streaming = ref(false);
const speechControls = ref(null);
const speechStatus = ref('idle');
const readingMessage = ref(null);
const speechBusy = computed(() => speechStatus.value !== 'idle');
const inputOverLimit = computed(() => inputText.value.length > 2000);
const speechState = ref({ status: 'idle', whisperReady: false, kokoroReady: false });
const conversationState = ref({
  status: 'stopped',
  error: '',
  progress: '',
  reviewText: '',
  reviewReason: '',
  turns: 0,
});
const conversationOwned = computed(() => conversationState.value.status !== 'stopped');
const conversationRunning = computed(
  () => conversationOwned.value && conversationState.value.status !== 'paused',
);
const conversationLocked = computed(
  () =>
    conversationOwned.value &&
    (conversationState.value.status !== 'paused' ||
      conversationState.value.settling ||
      conversationState.value.ending),
);
const conversationDownloadMB = computed(() =>
  Math.round(
    (getModelOption(selectedModelId.value)?.approxBytes || 0) / 1e6 +
      SPEECH_MODELS.whisper.downloadMB +
      SPEECH_MODELS.vad.downloadMB +
      (preferences.value.provider === 'neural' ? SPEECH_MODELS.kokoro.downloadMB : 0),
  ),
);
const voiceReview = ref('');
let conversation = null,
  restoringConversation = false,
  conversationInstructionsActive = false;
const speech = new SpeechSession({
  ...(props.speechOptions || {}),
  onChange: (value) => {
    speechState.value = value;
    speechStatus.value = value.status;
  },
  onTranscript: appendTranscript,
});
function appendTranscript(text) {
  inputText.value += (inputText.value && !/\s$/.test(inputText.value) ? ' ' : '') + text;
  void focusComposer({ force: true });
}
async function readMessage(msg, idx) {
  if (conversationOwned.value || streaming.value || speechBusy.value || !msg.speechReady) return;
  readingMessage.value = idx;
  try {
    await speechControls.value?.speak(msg.content);
  } finally {
    if (readingMessage.value === idx) readingMessage.value = null;
  }
}
const tokenCount = ref(null);
const clearModalOpen = ref(false);
const { root: workspaceRoot, height: workspaceHeight } = useChatWorkspace();
const settingsOpen = ref(false);
const settingsButton = ref(null);
const settingsId = `wwl-chat-settings-${useId()}`;
const voiceSettingsTarget = ref(null);
const conversationLabel = computed(
  () =>
    ({
      loading: 'Loading Voice Conversation Mode…',
      listening: 'Listening… Pause for about 1.2 seconds to send.',
      transcribing: 'Microphone off · transcribing…',
      thinking: 'Microphone off · thinking…',
      'preparing-audio': 'Microphone off · preparing neural audio…',
      speaking: 'Microphone off · speaking…',
      paused: 'Voice conversation paused. Resume starts a new listening turn.',
    })[conversationState.value.status] || '',
);
const manualSpeechLabel = computed(
  () =>
    ({
      recording: `Microphone recording · ${speechState.value.recordingSeconds || 0} / 60 s`,
      transcribing: 'Transcribing on this device…',
      preparing: 'Waiting for microphone…',
      loading: 'Loading speech model…',
      speaking:
        speechState.value.playbackPhase === 'preparing'
          ? 'Preparing neural audio on this device…'
          : 'Reading aloud…',
    })[speechState.value.status] || '',
);
const storageUsage = ref('—');
const storageQuota = ref('—');
const storagePct = ref(0);
const errorBanner = ref('');
const messagesEl = ref(null);
const composerInput = ref(null);
const stickToBottom = ref(true);
const capacityNote = ref('');
const freezeHint = ref('');
const contextNotice = ref('');
let savedHistory = [];
let alive = true;
let uiOperation = 0;
let generationAbort = null;
const selectedPrimaryId = computed(
  () => getModelOption(selectedModelId.value)?.variantOf || selectedModelId.value,
);
const selectedVariants = computed(() => getModelVariants(selectedModelId.value));

let unsubProgress = null;

const displayTitle = computed(() => `AI Chat (${getModelDisplayName(selectedModelId.value)})`);

const deviceSummary = computed(() => {
  const info = systemInfo.value;
  if (!info) return 'Checking…';
  const mem = info.deviceMemory != null ? `~${info.deviceMemory} GB RAM*` : 'RAM n/a';
  const cores =
    info.hardwareConcurrency != null ? `${info.hardwareConcurrency} cores` : 'cores n/a';
  const buf =
    info.maxStorageBufferBindingSize != null
      ? `buf ${(info.maxStorageBufferBindingSize / (1024 * 1024)).toFixed(0)} MB`
      : '';
  return [mem, cores, buf].filter(Boolean).join(' · ');
});

const groupedModels = computed(() =>
  MODEL_GROUPS.map((group) => ({
    ...group,
    models: PRIMARY_MODEL_OPTIONS.filter(
      (m) => m.group === group.id && (!props.flowchartDocument || m.capabilities?.tools),
    ).map((model) => {
      const resolved = resolveModelForSystem(model.id);
      return {
        ...model,
        resolved,
        cached: isModelLikelyCached(model.id),
        label: buildOptionLabel(model, resolved),
      };
    }),
  })).filter((group) => group.models.length),
);

function cacheFlagKey(modelId) {
  return `${MODEL_CACHE_FLAG_PREFIX}${modelId}`;
}

function isModelLikelyCached(modelId) {
  try {
    return localStorage.getItem(cacheFlagKey(modelId)) === '1';
  } catch {
    return false;
  }
}

function markModelCached(modelId) {
  try {
    localStorage.setItem(cacheFlagKey(modelId), '1');
  } catch {
    /* ignore */
  }
}

function resolveModelForSystem(modelId) {
  const option = getModelOption(modelId);
  if (!option) {
    return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
  }

  const runtimeBlock = getLiteRTRuntimeBlockReason(option);
  if (runtimeBlock) {
    return {
      modelId,
      changed: false,
      unavailable: false,
      loadBlocked: true,
      reason: runtimeBlock,
    };
  }

  if (!systemInfo.value) {
    return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
  }
  if (!systemInfo.value.webgpuSupported || systemInfo.value.error)
    return {
      modelId,
      changed: false,
      unavailable: true,
      loadBlocked: false,
      reason:
        'WebGPU is unavailable in this browser. Model loading requires a compatible browser and GPU.',
    };
  const missing = (option.requires || []).filter((feature) => {
    if (feature === 'shader-f16') return !systemInfo.value.shaderF16;
    return true;
  });
  if (missing.length && option.fallbackId && !option.experimental) {
    return {
      modelId: option.fallbackId,
      changed: true,
      unavailable: false,
      loadBlocked: false,
      reason: `Using compatibility fallback (${option.fallbackId}) because shader-f16 is not available.`,
    };
  }
  if (missing.length) {
    return {
      modelId,
      changed: false,
      unavailable: true,
      loadBlocked: false,
      reason: `This model requires ${missing.join(', ')}. Choose another model on this device.`,
    };
  }
  return { modelId, changed: false, unavailable: false, loadBlocked: false, reason: '' };
}

function buildOptionLabel(model, resolved) {
  const flags = [];
  if (model.litertKind === 'web-official') flags.push('LiteRT official web');
  else if (model.litertKind === 'portable') flags.push('LiteRT portable');
  if (resolved.loadBlocked) flags.push('Runtime unsupported');
  if (isModelLikelyCached(model.id)) flags.push('Cached');
  if (resolved.unavailable) flags.push('Unavailable');
  return `${getModelChoiceLabel(model)}${flags.length ? ` — ${flags.join(' — ')}` : ''}`;
}

const selectedResolved = computed(() => resolveModelForSystem(selectedModelId.value));
const loadDisabled = computed(
  () => loading.value || selectedResolved.value.unavailable || selectedResolved.value.loadBlocked,
);

async function detectSystemInfo() {
  const info = {
    webgpuSupported: !!navigator.gpu,
    adapterName: null,
    shaderF16: false,
    error: null,
    ...collectDeviceSignals(null),
  };
  if (!navigator.gpu) return info;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      info.error = 'No adapter found';
      return info;
    }
    info.adapterName = adapter.name || 'Unknown adapter';
    info.shaderF16 = !!(adapter.features && adapter.features.has('shader-f16'));
    Object.assign(info, collectDeviceSignals(adapter));
  } catch (err) {
    info.error = err?.message || 'Adapter detection failed';
  }
  return info;
}

function refreshCapacityNote(modelId = selectedModelId.value) {
  const resolved = resolveModelForSystem(modelId);
  if (resolved.loadBlocked || resolved.unavailable) {
    capacityNote.value = '';
    return;
  }
  const assessment = assessLoadCapacity({
    modelId: resolved.modelId,
    systemInfo: systemInfo.value || {},
  });
  if (assessment.level === 'ok') {
    capacityNote.value = '';
    return;
  }
  const prefer = assessment.recommendedLabel
    ? ` Prefer ${assessment.recommendedLabel} on weaker devices.`
    : '';
  capacityNote.value = `${assessment.level === 'high' ? 'Warning' : 'Caution'}: ${
    assessment.reasons[0] || 'This device may struggle with the selected model.'
  }${prefer}`;
}

function applySelection(modelId) {
  if (!getModelOption(modelId)) {
    errorBanner.value = 'This model is no longer supported. Choose a retained model and load it.';
    modelId = MODEL_OPTIONS[0].id;
    loaded.value = false;
  } else if (props.flowchartDocument && !getModelOption(modelId)?.capabilities?.tools) {
    modelId = MODEL_OPTIONS[0].id;
    loaded.value = false;
  }
  selectedModelId.value = modelId;
  const resolved = resolveModelForSystem(modelId);
  fallbackNote.value =
    resolved.changed || resolved.unavailable || resolved.loadBlocked ? resolved.reason : '';
  if (resolved.loadBlocked) {
    errorBanner.value = '';
  }
  cacheHint.value = resolved.loadBlocked
    ? ''
    : isModelLikelyCached(modelId) || isModelLikelyCached(resolved.modelId)
      ? 'This model looks cached in your browser — reload should skip a full download.'
      : 'First load downloads model weights into browser cache.';
  refreshCapacityNote(modelId);
  emit('model-change', selectedModelId.value);
  syncFlowchartTools();
  if (!loaded.value && chat && !resolved.loadBlocked && !resolved.unavailable) {
    void chat.setModelId(resolved.modelId).catch(() => {
      /* ignore while loading */
    });
  }
}

function isNearBottom(el, threshold = 80) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function onMessagesScroll() {
  stickToBottom.value = isNearBottom(messagesEl.value);
}

async function scrollToLatest(force = false) {
  await nextTick();
  const el = messagesEl.value;
  if (!el) return;
  if (force || stickToBottom.value) {
    el.scrollTop = el.scrollHeight;
    stickToBottom.value = true;
  }
}

function isOtherInteractiveControl(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el === composerInput.value) return false;
  if (typeof el.closest === 'function' && el.closest('[role="dialog"], .vd-modal')) return true;
  const tag = el.tagName;
  return (
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'A' ||
    el.isContentEditable === true
  );
}

/**
 * Keep keyboard UX on the composer after send/stream/load, without stealing
 * focus from model select / modal / other controls.
 * @param {{ force?: boolean }} [opts]
 */
async function focusComposer(opts = {}) {
  const force = !!opts.force;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const chatReady = loaded.value && !loading.value;
  if (
    !shouldFocusChatComposer({
      force,
      modalOpen: clearModalOpen.value || settingsOpen.value,
      chatReady,
      activeIsComposer: active === composerInput.value,
      activeIsOtherControl: isOtherInteractiveControl(active),
    })
  ) {
    return;
  }
  await nextTick();
  const el = composerInput.value;
  if (!el || clearModalOpen.value || settingsOpen.value || !loaded.value || loading.value) return;
  if (el.disabled) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

async function refreshStoragePanel() {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const usage = est.usage || 0;
      const quota = est.quota || 0;
      storageUsage.value = formatBytes(usage);
      storageQuota.value = quota ? formatBytes(quota) : '—';
      storagePct.value = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
    }
  } catch {
    storageUsage.value = '—';
    storageQuota.value = '—';
    storagePct.value = 0;
  }
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function loadModel({ signal, strict = false } = {}) {
  if (!chat || loading.value) return;
  const catalogId = selectedModelId.value;
  const resolved = resolveModelForSystem(catalogId);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    if (strict) throw new Error(resolved.reason);
    return;
  }

  errorBanner.value = '';
  applySelection(catalogId);
  await chat.setModelId(resolved.modelId, { resetMessages: true });
  if (signal?.aborted) throw new DOMException('Model loading stopped.', 'AbortError');
  // Keep the catalog option selected (fallback IDs are not in the <select>).
  selectedModelId.value = catalogId;
  loading.value = true;
  progressPct.value = 0;
  freezeHint.value = '';
  progressText.value =
    getModelOption(catalogId)?.backend === 'litert'
      ? 'Initializing LiteRT WebGPU engine…'
      : 'Initializing WebGPU engine…';
  statusTone.value = 'warn';
  statusText.value = 'Loading…';
  const stopLoad = () => chat?.cancel?.();
  signal?.addEventListener('abort', stopLoad, { once: true });
  try {
    await chat.load();
    if (signal?.aborted) throw new DOMException('Model loading stopped.', 'AbortError');
    await chat.setHistory(savedHistory);
    if (!alive) return;
    markModelCached(catalogId);
    markModelCached(resolved.modelId);
    loaded.value = true;
    statusTone.value = 'ok';
    statusText.value = `Online (${getModelDisplayName(catalogId)})`;
    progressText.value = '';
    freezeHint.value = '';
    stickToBottom.value = true;
    await refreshStoragePanel();
  } catch (err) {
    statusTone.value = 'danger';
    statusText.value = 'Error';
    // Keep the message only in the error banner (avoid muted + red duplicates).
    progressText.value = '';
    errorBanner.value = err?.message || 'Failed to load model.';
    freezeHint.value = '';
    if (strict) throw err;
  } finally {
    signal?.removeEventListener('abort', stopLoad);
    loading.value = false;
  }
  if (loaded.value && !conversationOwned.value) await focusComposer();
}

async function ensureConversationChat({ signal, onProgress, settings }) {
  onProgress(`Loading ${getModelDisplayName(settings.modelId)}…`);
  const history = chat.getHistory?.() || savedHistory;
  savedHistory = history;
  if (!conversationInstructionsActive) {
    chat.setSystemPromptOptions?.({
      extraRules:
        'For this spoken conversation, answer in 1–3 short conversational sentences. Use natural spoken English, avoid unnecessary lists and markdown, and keep the reply concise.',
    });
    conversationInstructionsActive = true;
  }
  if (!loaded.value || chat.modelId !== settings.modelId) {
    selectedModelId.value = settings.modelId;
    loaded.value = false;
    await loadModel({ signal, strict: true });
  }
  if (signal.aborted) throw new DOMException('Conversation stopped.', 'AbortError');
}
function startConversation(reviewedText = null) {
  if (!chat || restoringConversation || conversationState.value.settling) return;
  conversation ||= new ConversationSession({
    speech,
    getSettings: () => ({
      ...preferences.value,
      modelId: selectedModelId.value,
      maxOutputTokens: getModelOption(selectedModelId.value)?.reasoning === 'required' ? 1024 : 192,
    }),
    preflight: (settings) => {
      if (settings.provider === 'neural') getKokoroVoice(settings.voiceId);
      else if (!localEnglishVoices().some((v) => v.voiceURI === settings.voiceURI))
        throw new Error('Choose an installed local English voice before starting.');
      const resolved = resolveModelForSystem(settings.modelId);
      if (resolved.changed)
        throw new Error(
          'Select the compatible precision in model settings before starting Voice Conversation Mode.',
        );
      if (resolved.unavailable || resolved.loadBlocked)
        throw new Error(resolved.reason || 'The selected model is unavailable on this device.');
    },
    ensureChat: ensureConversationChat,
    submitTurn: (text, options) => submitTurn(text, { ...options, voice: true }),
    cancelChat: () => {
      generationAbort?.abort();
      chat?.cancel?.();
    },
    restoreInstructions: () => {
      chat?.setSystemPromptOptions?.({});
      conversationInstructionsActive = false;
    },
    ...(props.conversationOptions || {}),
    onChange: (state) => {
      conversationState.value = state;
      voiceReview.value = state.reviewText;
    },
  });
  void conversation.start({ reviewedText });
}
async function endConversation() {
  if (!conversation) return;
  restoringConversation = true;
  try {
    await conversation.end();
  } finally {
    restoringConversation = false;
  }
}
function foregroundChanged() {
  if (document.hidden && conversationOwned.value) conversation?.pause();
}
function pauseForPage() {
  if (conversationOwned.value) conversation?.pause();
}

async function switchModel() {
  if (!chat || loading.value || streaming.value) return;
  await endConversation();
  speech.dispose();
  const resolved = resolveModelForSystem(selectedModelId.value);
  if (resolved.unavailable || resolved.loadBlocked) {
    errorBanner.value = resolved.reason;
    progressText.value = '';
    return;
  }
  if (resolved.modelId === chat.modelId && loaded.value) return;
  loaded.value = false;
  savedHistory = [];
  messages.value = [];
  tokenCount.value = null;
  stickToBottom.value = true;
  chat.reset();
  await loadModel();
}

onActivated(() => {
  if (!conversationLocked.value) preferences.value = readChatPreferences();
});

function stopGeneration() {
  previewText.value = '';
  previewIndex.value = -1;
  if (conversationOwned.value) conversation?.pause();
  generationAbort?.abort();
  chat?.cancel?.();
}
async function resetConversation() {
  await endConversation();
  speech.dispose();
  generationAbort?.abort();
  const operation = ++uiOperation;
  previewText.value = '';
  previewIndex.value = -1;
  chat?.reset();
  messages.value = [];
  savedHistory = [];
  contextNotice.value = '';
  errorBanner.value = '';
  await chat?.setHistory?.([]);
  if (alive && operation === uiOperation) streaming.value = false;
}
async function sendMessage() {
  if (
    !chat ||
    conversationOwned.value ||
    !loaded.value ||
    streaming.value ||
    inputOverLimit.value ||
    (speechBusy.value && speechStatus.value !== 'speaking')
  )
    return;
  speech.cancel();
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  await submitTurn(text);
}
async function submitTurn(
  text,
  {
    signal: outerSignal,
    maxOutputTokens = flowchartTools.value && props.flowchartDocument ? 1536 : 768,
    voice = false,
  } = {},
) {
  if (!chat || !loaded.value || streaming.value)
    throw new Error('Chat is not ready for another turn.');
  const guard = validateLlmInput(text);
  if (!guard.allowed) {
    errorBanner.value = guard.message;
    if (voice) throw toGuardrailError(guard);
    return;
  }
  const operation = ++uiOperation;
  const current = () => alive && operation === uiOperation;
  const controller = new AbortController();
  const stop = () => controller.abort();
  outerSignal?.addEventListener('abort', stop, { once: true });
  if (outerSignal?.aborted) {
    stop();
    outerSignal.removeEventListener('abort', stop);
    throw new DOMException('Stopped', 'AbortError');
  }
  generationAbort = controller;
  errorBanner.value = '';
  messages.value.push({ role: 'user', content: text });
  messages.value.push({ role: 'assistant', content: '' });
  const assistantIdx = messages.value.length - 1;
  previewIndex.value = assistantIdx;
  previewText.value = '';
  streaming.value = true;
  stickToBottom.value = true;
  await scrollToLatest(true);
  if (!voice) await focusComposer({ force: true });
  try {
    let images = [];
    if (getModelOption(selectedModelId.value)?.capabilities?.vision && props.captureFlowchart) {
      images = visionImagesForModel(getModelOption(selectedModelId.value), [
        { dataUrl: await props.captureFlowchart() },
      ]);
    }
    const turnOptions = {
      signal: controller.signal,
      maxOutputTokens,
      flowchartDocument: props.flowchartDocument,
      images,
      delivery: voice ? 'complete' : delivery.value,
      onPreview: (text) => {
        if (current() && !controller.signal.aborted) {
          previewText.value = text;
          void scrollToLatest();
        }
      },
      onContext: ({
        omittedTurns,
        omittedSources = 0,
        rejectedSources = 0,
        rejectedHistoryTurns = 0,
      }) => {
        if (current())
          contextNotice.value = [
            omittedSources ? `${omittedSources} reference(s) omitted by the source limit.` : '',
            omittedTurns ? `${omittedTurns} older turn(s) omitted from model context.` : '',
            rejectedSources ? `${rejectedSources} reference(s) rejected by guardrails.` : '',
            rejectedHistoryTurns
              ? `${rejectedHistoryTurns} history turn(s) rejected by guardrails.`
              : '',
          ]
            .filter(Boolean)
            .join(' ');
      },
      onUpdate: (partial) => {
        if (!current() || controller.signal.aborted) return;
        messages.value[assistantIdx] = { role: 'assistant', content: partial };
        void scrollToLatest();
      },
      onFinish: (usage) => {
        if (current()) tokenCount.value = usage?.total_tokens ?? null;
      },
    };
    const toolsReady = flowchartTools.value && typeof chat.generateWithTools === 'function';
    let diagramApplied = false;
    const execute = async (name, args) => {
      const result = await executeFlowchartTool(name, args);
      if (result?.ok) diagramApplied = true;
      return result;
    };
    let reply = toolsReady
      ? await chat.generateWithTools(text, {
          ...turnOptions,
          execute,
        })
      : await chat.generate(text, turnOptions);
    if (
      current() &&
      !controller.signal.aborted &&
      toolsReady &&
      !diagramApplied &&
      flowchartDrawNeedsFollowUp(text, props.flowchartDocument, props.flowchartDocument)
    ) {
      try {
        const follow = await chat.generateWithTools(FLOWCHART_DRAW_FOLLOW_UP, {
          ...turnOptions,
          execute,
        });
        if (current() && !controller.signal.aborted) reply = follow;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }
    if (!current() || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const answer = reply;
    messages.value[assistantIdx] = { role: 'assistant', content: answer, speechReady: true };
    return answer;
  } catch (err) {
    if (!current()) {
      if (voice) throw err;
      return;
    }
    const stopped = err?.name === 'AbortError';
    const msg = stopped ? 'Generation stopped.' : err?.message || 'Generation failed.';
    if (!stopped) errorBanner.value = msg;
    messages.value[assistantIdx] = { role: 'assistant', content: msg };
    if (voice) throw err;
  } finally {
    outerSignal?.removeEventListener('abort', stop);
    if (current()) {
      generationAbort = null;
      previewText.value = '';
      previewIndex.value = -1;
      streaming.value = false;
      await scrollToLatest(true);
      if (!voice) await focusComposer();
    }
  }
}

function onComposerKeydown(event) {
  if (event.key !== 'Enter') return;
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendMessage();
}

async function clearModelStorage() {
  await resetConversation();
  try {
    await chat?.dispose?.();
    await clearChatCaches();
    await clearSpeechCaches();
    try {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith(MODEL_CACHE_FLAG_PREFIX),
      );
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* storage may be disabled */
    }
    errorBanner.value = '';
    statusText.value = 'Chat model storage cleared';
  } catch (error) {
    errorBanner.value = `Some chat assets could not be cleared: ${error.message}`;
  }
  clearModalOpen.value = false;
  loaded.value = false;
  statusTone.value = 'muted';
  await refreshStoragePanel();
}

function renderMarkdown(text) {
  try {
    return labsMarkdownToHtml(String(text || ''));
  } catch {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

onMounted(async () => {
  // Reuse one AiChat/WebLLM runtime for the tab (HMR / v-if remount safe).
  if (props.chat) chat = props.chat;
  else if (!chat) {
    chat = new AiChat(chatRuntimeOptions);
  }

  selectedModelId.value = chat.modelId || MODEL_OPTIONS[0].id;
  emit('model-change', selectedModelId.value);
  syncFlowchartTools();
  systemInfo.value = await detectSystemInfo();
  if (!alive) return;
  applySelection(selectedModelId.value);
  loaded.value = !!chat.isLoaded?.();
  if (loaded.value) {
    statusTone.value = 'ok';
    statusText.value = `Online (${getModelDisplayName(chat.modelId)})`;
    await focusComposer();
  }
  if (unsubProgress) unsubProgress();
  unsubProgress = chat.onProgress((data) => {
    const described = describeLoadProgress(data, {
      likelyCached: isModelLikelyCached(chat.modelId),
    });
    if (described.stage === 'error') {
      // Surface via errorBanner from load/generate catch — don't duplicate in progress.
      progressText.value = '';
      freezeHint.value = '';
      statusTone.value = 'danger';
      statusText.value = 'Error';
      return;
    }
    progressPct.value = described.progressPct;
    if (loading.value && conversationState.value.status === 'loading')
      conversation?.update({
        progress: `${getModelDisplayName(selectedModelId.value)}: ${described.progressText}`,
      });
    progressText.value = described.progressText;
    freezeHint.value = described.freezeHint;
    statusText.value = described.statusText;
    statusTone.value = described.statusTone;
  });
  await refreshStoragePanel();
  refreshCapacityNote(selectedModelId.value);
  document.addEventListener('visibilitychange', refreshStoragePanel);
  document.addEventListener('visibilitychange', foregroundChanged);
  document.addEventListener('freeze', pauseForPage);
  window.addEventListener('pagehide', pauseForPage);
  window.addEventListener('keydown', onNestedClearKeydown, true);
});

onBeforeUnmount(() => {
  conversation?.pause();
  speech.dispose();
  generationAbort?.abort();
  alive = false;
  uiOperation += 1;
  chat?.cancel?.();
  if (!props.chat) void chat?.dispose?.();
  if (unsubProgress) {
    unsubProgress();
    unsubProgress = null;
  }
  document.removeEventListener('visibilitychange', refreshStoragePanel);
  document.removeEventListener('visibilitychange', foregroundChanged);
  document.removeEventListener('freeze', pauseForPage);
  window.removeEventListener('pagehide', pauseForPage);
  window.removeEventListener('keydown', onNestedClearKeydown, true);
});

watch(
  () => props.chat,
  (next) => {
    if (next) chat = next;
  },
);

watch(
  () => props.flowchartDocument,
  (doc) => {
    if (doc && !getModelOption(selectedModelId.value)?.capabilities?.tools) {
      applySelection(MODEL_OPTIONS[0].id);
    } else {
      syncFlowchartTools();
    }
  },
);

watch(clearModalOpen, async (open, wasOpen) => {
  if (wasOpen && !open && loaded.value && !loading.value) {
    await focusComposer();
  }
});

watch(settingsOpen, (open) => {
  if (open) return;
  // WebKit drops the dialog's focus return during Escape. Put focus back on
  // Settings once the key event has finished, and leave a restore that already
  // landed on a control alone.
  setTimeout(() => {
    if (!alive || settingsOpen.value || clearModalOpen.value) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    const el = settingsButton.value?.$el ?? settingsButton.value;
    el?.focus?.({ preventScroll: true });
  }, 0);
});
watch(loaded, async (isLoaded, wasLoaded) => {
  if (isLoaded && !wasLoaded && !loading.value && !clearModalOpen.value) {
    await focusComposer();
  }
});
watch(selectedModelId, () => {
  if (!conversationOwned.value) speech.dispose();
});
function clearStorageDialog() {
  return document.querySelector('.vd-modal[aria-label="Clear model storage?"]');
}

function onNestedClearKeydown(event) {
  if (!settingsOpen.value || !clearModalOpen.value) return;
  const dialog = clearStorageDialog();
  if (!dialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearModalOpen.value = false;
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...dialog.querySelectorAll('button:not([disabled])')].filter(
    (el) => el.getClientRects().length > 0,
  );
  if (!controls.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const first = controls[0];
  const last = controls[controls.length - 1];
  const index = controls.indexOf(document.activeElement);
  const next = event.shiftKey
    ? index <= 0
      ? last
      : controls[index - 1]
    : index === -1 || index >= controls.length - 1
      ? first
      : controls[index + 1];
  next.focus();
}

async function suspend() {
  settingsOpen.value = false;
  await endConversation();
  speech.dispose();
  uiOperation++;
  previewText.value = '';
  previewIndex.value = -1;
  generationAbort?.abort();
  chat?.cancel();
  if (chat) {
    savedHistory = chat.getHistory();
    await chat.dispose();
  }
  loaded.value = false;
  loading.value = false;
  streaming.value = false;
  statusText.value = 'Not loaded';
}
defineExpose({ suspend, getModelId: () => selectedModelId.value });
</script>

<template>
  <div ref="workspaceRoot" class="wwl-ai-workspace-host">
    <VdCard
      class="wwl-ai-chat-wrap wwl-card-glow vd-glass"
      :style="{ '--wwl-chat-height': workspaceHeight }"
      :aria-busy="loading ? 'true' : 'false'"
    >
      <div class="wwl-ai-chat-primary">
        <div class="wwl-ai-header">
          <div class="wwl-ai-header-left">
            <VdIcon name="robot" />
            <h3 class="wwl-ai-title">{{ displayTitle }}</h3>
          </div>
          <div class="wwl-ai-header-status">
            <span class="wwl-ai-status-dot" :data-tone="statusTone"></span>
            <span>{{ statusText }}</span>
          </div>
          <div class="wwl-ai-header-actions">
            <VdButton
              v-if="loaded"
              size="sm"
              variant="ghost"
              :disabled="loading"
              @click="resetConversation"
              >New conversation</VdButton
            >
            <VdButton
              v-if="!conversationOwned"
              variant="primary"
              :disabled="!systemInfo || loading || streaming || speechBusy"
              @click="startConversation()"
              >Voice Conversation Mode</VdButton
            >
            <template v-else>
              <VdButton
                v-if="conversationRunning"
                variant="secondary"
                @click="conversation?.pause()"
                >Pause conversation</VdButton
              >
              <VdButton
                v-else
                variant="primary"
                :disabled="conversationState.ending || conversationState.settling"
                @click="startConversation()"
                >Resume conversation</VdButton
              >
              <VdButton
                variant="ghost"
                :disabled="conversationState.ending || conversationState.settling"
                @click="endConversation"
                >End conversation</VdButton
              >
            </template>
            <VdButton
              ref="settingsButton"
              size="sm"
              variant="ghost"
              :aria-expanded="settingsOpen"
              :aria-controls="settingsId"
              @click="settingsOpen = !settingsOpen"
              ><VdIcon name="sliders-horizontal" aria-hidden="true" />Settings</VdButton
            >
          </div>
        </div>

        <div class="wwl-ai-chat-interface">
          <div
            ref="messagesEl"
            class="wwl-ai-messages"
            aria-live="polite"
            @scroll.passive="onMessagesScroll"
          >
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              class="wwl-ai-message"
              :data-role="msg.role"
            >
              <div class="wwl-ai-message-role">{{ msg.role === 'user' ? 'You' : 'Assistant' }}</div>
              <div
                v-if="idx === previewIndex && previewText"
                class="wwl-ai-message-body wwl-checked-preview"
              >
                {{ previewText }}
              </div>
              <div v-else class="wwl-ai-message-body" v-html="renderMarkdown(msg.content)"></div>
              <p
                v-if="
                  msg.role === 'assistant' &&
                  ((idx === messages.length - 1 &&
                    ['preparing-audio', 'speaking'].includes(conversationState.status)) ||
                    (readingMessage === idx && speechStatus === 'speaking'))
                "
                class="wwl-ai-voice-progress"
                role="status"
                aria-live="polite"
              >
                <VdSpinner size="sm" aria-hidden="true" />
                {{
                  speechState.playbackPhase === 'preparing' ||
                  conversationState.status === 'preparing-audio'
                    ? 'Preparing voice… Kokoro is generating audio on this device.'
                    : 'Playing voice…'
                }}
              </p>
              <template v-if="msg.role === 'assistant' && msg.speechReady">
                <VdButton
                  v-if="readingMessage === idx && speechStatus === 'speaking'"
                  size="sm"
                  variant="ghost"
                  @click="speechControls?.cancel()"
                  >Stop reading</VdButton
                >
                <VdButton
                  v-else
                  size="sm"
                  variant="ghost"
                  :disabled="streaming || speechBusy || conversationOwned"
                  @click="readMessage(msg, idx)"
                  >Read aloud</VdButton
                >
              </template>
            </div>
            <div v-if="!messages.length" class="wwl-ai-empty">
              <VdIcon name="chat-circle-dots" aria-hidden="true" />
              <h4>
                {{
                  loaded
                    ? 'What would you like to talk about?'
                    : 'Your private conversation starts here'
                }}
              </h4>
              <p>
                {{
                  loaded
                    ? 'Ask anything. Answers stay on this device.'
                    : 'Open Settings to load a model, or choose Voice Conversation Mode above.'
                }}
              </p>
              <p v-if="flowchartDocument">
                Turn the flowchart off to choose from more chat models.
              </p>
              <VdButton
                v-if="!loaded && !settingsOpen"
                size="sm"
                variant="secondary"
                @click="settingsOpen = true"
                >Open Settings</VdButton
              >
            </div>
          </div>

          <div v-if="conversationState.reviewReason" class="wwl-conversation-review">
            <p role="alert">{{ conversationState.reviewReason }}</p>
            <label
              >Review voice message<textarea
                v-model="voiceReview"
                class="wwl-ai-input"
                rows="3"
                :readonly="conversationRunning"
              ></textarea>
            </label>
            <p>{{ voiceReview.length }} / 2000 · Your typed draft is separate.</p>
            <VdButton
              :disabled="
                conversationRunning ||
                conversationState.ending ||
                !voiceReview.trim() ||
                voiceReview.length > 2000
              "
              @click="startConversation(voiceReview)"
              >Send reviewed voice message</VdButton
            >
          </div>
          <form class="wwl-ai-form" @submit.prevent="sendMessage">
            <textarea
              ref="composerInput"
              v-model="inputText"
              class="wwl-ai-input"
              aria-label="Message"
              rows="2"
              placeholder="Message the local model… (Enter to send, Shift+Enter for newline)"
              :readonly="streaming || conversationOwned"
              :disabled="!loaded"
              @keydown="onComposerKeydown"
            ></textarea>
            <div class="wwl-ai-form-meta">
              <WwlChatSpeech
                ref="speechControls"
                :session="speech"
                :session-state="speechState"
                :conversation-owned="conversationOwned"
                :voice-settings="preferences"
                :settings-disabled="loading || streaming || conversationLocked"
                @voice-settings="updatePreferences"
                :options="speechOptions"
                :disabled="!loaded || streaming || loading || conversationOwned"
                :settings-target="voiceSettingsTarget"
                compact
                @transcript="appendTranscript"
                @state="speechStatus = $event.status"
              />

              <span class="vd-text-sm vd-text-muted">{{ inputText.length }} / 2000</span>
              <span v-if="tokenCount != null" class="vd-text-sm vd-text-muted"
                >Tokens: {{ tokenCount }}</span
              >
              <VdButton v-if="streaming" variant="secondary" @click="stopGeneration">Stop</VdButton>
              <VdButton
                v-else
                type="submit"
                variant="primary"
                :loading="streaming"
                :disabled="
                  !loaded ||
                  streaming ||
                  conversationOwned ||
                  !inputText.trim() ||
                  inputOverLimit ||
                  (speechBusy && speechStatus !== 'speaking')
                "
              >
                <VdIcon v-if="!streaming" name="paper-plane-tilt" />
                <VdSpinner v-else size="sm" />
                Send
              </VdButton>
            </div>
          </form>
          <div class="wwl-ai-live-status" role="status" aria-live="polite">
            <VdSpinner
              v-if="
                conversationRunning ||
                loading ||
                streaming ||
                (manualSpeechLabel && speechStatus !== 'recording')
              "
              size="sm"
              aria-hidden="true"
            />
            <span v-if="conversationOwned || manualSpeechLabel || loading || streaming">{{
              conversationOwned
                ? conversationLabel
                : manualSpeechLabel ||
                  (loading
                    ? 'Loading model…'
                    : delivery === 'checked-stream'
                      ? 'Generating checked reply…'
                      : 'Generating and checking reply…')
            }}</span>
          </div>
          <p v-if="contextNotice" class="wwl-ai-context-note" role="status">{{ contextNotice }}</p>
          <p v-if="inputOverLimit" class="wwl-ai-error" role="alert">
            Your draft is preserved. Edit it to 2000 characters or fewer before sending.
          </p>
          <p v-if="errorBanner" class="wwl-ai-error" role="alert">{{ errorBanner }}</p>

          <p v-if="conversationState.error" class="wwl-ai-error" role="alert">
            {{ conversationState.error }}
          </p>
          <p v-if="speechState.error" class="wwl-ai-error" role="alert">{{ speechState.error }}</p>
          <p
            v-if="
              !loaded &&
              (selectedResolved.unavailable || selectedResolved.loadBlocked) &&
              selectedResolved.reason
            "
            class="wwl-ai-error"
            role="alert"
          >
            {{ selectedResolved.reason }}
          </p>
          <p
            v-if="
              conversationState.cacheAvailable === false || speechState.cacheAvailable === false
            "
            class="wwl-ai-note"
            role="status"
          >
            Browser storage is unavailable. Future model loads may need a connection.
          </p>
        </div>
      </div>
    </VdCard>
  </div>
  <VdModal
    :id="settingsId"
    v-model:open="settingsOpen"
    class="wwl-ai-settings-modal"
    title="Settings"
    size="xl"
  >
    <div class="wwl-ai-settings-layout">
      <div class="wwl-ai-settings-columns">
        <div class="wwl-ai-settings-column">
          <section aria-label="Model settings">
            <h4>Model</h4>
            <div class="wwl-ai-setup-grid">
              <div class="wwl-ai-setup-col">
                <label class="wwl-form-label" for="wwl-ai-model-select"
                  >Model · download size shown before loading</label
                >
                <select
                  id="wwl-ai-model-select"
                  class="vd-select wwl-ai-model-select"
                  :value="selectedPrimaryId"
                  :disabled="loading || streaming || conversationLocked"
                  @change="applySelection($event.target.value)"
                >
                  <optgroup v-for="group in groupedModels" :key="group.id" :label="group.label">
                    <option
                      v-for="model in group.models"
                      :key="model.id"
                      :value="model.id"
                      :disabled="systemInfo?.webgpuSupported === false"
                    >
                      {{ model.label }}
                    </option>
                  </optgroup>
                </select>
                <label
                  v-if="selectedVariants.length > 1"
                  class="wwl-ai-note"
                  for="wwl-ai-precision-select"
                  >Precision</label
                >
                <select
                  v-if="selectedVariants.length > 1"
                  id="wwl-ai-precision-select"
                  class="vd-select"
                  :value="selectedModelId"
                  :disabled="loading || streaming || conversationLocked"
                  @change="applySelection($event.target.value)"
                >
                  <option v-for="variant in selectedVariants" :key="variant.id" :value="variant.id">
                    {{ variant.precision.toUpperCase()
                    }}{{ variant.variantOf ? ' · Compatibility' : '' }} ·
                    {{ Math.round(variant.approxBytes / 1e6) }} MB
                  </option>
                </select>
                <p v-if="fallbackNote && !selectedResolved.loadBlocked" class="wwl-ai-note">
                  {{ fallbackNote }}
                </p>
                <details class="wwl-ai-diagnostics" open>
                  <summary>Model details</summary>
                  <WwlModelDetails :model-id="selectedModelId" />
                </details>
                <p v-if="cacheHint" class="wwl-ai-note">{{ cacheHint }}</p>
                <p v-if="capacityNote" class="wwl-ai-capacity-note" role="status">
                  {{ capacityNote }}
                </p>
              </div>
            </div>

            <p class="vd-text-muted vd-text-sm">
              Gemma 4 E2B is the default. Experimental Ministral 3 and Mistral 7B choices are
              optional, and Qwen3 0.6B is not offered. Inference stays in your browser.
            </p>

            <div v-if="(loading || progressText) && !errorBanner" class="wwl-ai-progress">
              <VdProgress :value="progressPct" />
              <div class="vd-text-sm vd-text-muted">{{ progressText }}</div>
              <p v-if="freezeHint" class="wwl-ai-freeze-hint">{{ freezeHint }}</p>
            </div>

            <p
              v-if="fallbackNote && selectedResolved.loadBlocked"
              class="wwl-ai-error"
              role="status"
            >
              {{ fallbackNote }}
            </p>

            <div class="wwl-ai-setup-actions">
              <VdButton
                variant="primary"
                :loading="loading"
                :disabled="loadDisabled || streaming || conversationLocked"
                @click="
                  conversationOwned ? startConversation() : loaded ? switchModel() : loadModel()
                "
              >
                <VdIcon name="download-simple" />
                {{
                  conversationOwned
                    ? 'Resume with selected settings'
                    : selectedResolved.loadBlocked
                      ? 'Runtime unsupported'
                      : loaded
                        ? 'Switch model'
                        : 'Load AI Model'
                }}
              </VdButton>
            </div>
          </section>
          <section aria-label="Reply delivery settings">
            <h4>Text replies</h4>
            <label
              >Reply delivery<select
                v-model="delivery"
                class="vd-select"
                :disabled="loading || streaming || conversationLocked"
              >
                <option value="checked-stream">Checked live text</option>
                <option value="complete">Full-answer check</option>
              </select></label
            >
            <p class="wwl-ai-note">
              Live text is checked before display. Later context can still trigger a block after
              earlier text appeared. Spoken turns always use a full-answer check.
            </p>
          </section>
        </div>
        <section aria-label="Voice settings">
          <h4>Voice</h4>
          <p class="wwl-ai-note">
            Voice Conversation Mode uses the selected chat model and voice, Whisper and voice
            detection · about
            {{ conversationDownloadMB }} MB of model downloads, plus runtime files. Loaded models
            are reused. English · take turns.
          </p>
          <p v-if="conversationOwned && conversationState.progress" class="wwl-ai-note">
            {{ conversationState.progress }}
          </p>
          <div ref="voiceSettingsTarget"></div>
        </section>
      </div>
      <hr class="wwl-ai-settings-separator" />
      <section aria-label="Storage settings" class="wwl-ai-settings-clear">
        <h4>Storage</h4>
        <details class="wwl-ai-diagnostics">
          <summary>Device and storage details</summary>
          <aside class="wwl-ai-storage-panel" aria-label="Local storage for this site">
            <div class="wwl-ai-storage-title">Storage &amp; memory</div>
            <div class="vd-text-sm vd-text-muted">
              This origin: <strong>{{ storageUsage }}</strong>
            </div>
            <div class="vd-text-sm vd-text-muted">Quota: {{ storageQuota }}</div>
            <div class="wwl-ai-storage-meter" aria-hidden="true">
              <div class="wwl-ai-storage-meter-fill" :style="{ width: storagePct + '%' }"></div>
            </div>
            <p class="wwl-ai-fineprint">
              Includes Cache Storage / IndexedDB for this page. GPU memory is not available to the
              page.
            </p>
          </aside>

          <div class="wwl-ai-system-info">
            <div class="wwl-ai-storage-title">System Info</div>
            <div class="vd-text-sm vd-text-muted">
              WebGPU:
              {{
                systemInfo
                  ? systemInfo.webgpuSupported
                    ? 'Supported'
                    : 'Not supported'
                  : 'Checking…'
              }}
            </div>
            <div class="vd-text-sm vd-text-muted">
              GPU: {{ systemInfo?.adapterName || systemInfo?.error || 'Detecting…' }}
            </div>
            <div class="vd-text-sm vd-text-muted">
              shader-f16:
              {{ systemInfo ? (systemInfo.shaderF16 ? 'Supported' : 'Unavailable') : 'Checking…' }}
            </div>
            <div
              class="vd-text-sm vd-text-muted"
              :title="'deviceMemory is browser-capped/approximate; GPU VRAM is not exposed to web pages.'"
            >
              Device: {{ deviceSummary }}
            </div>
          </div>
        </details>
        <VdButton
          size="sm"
          variant="ghost"
          :disabled="loading || streaming || conversationLocked"
          @click="clearModalOpen = true"
          ><VdIcon name="trash" />Clear storage</VdButton
        >
      </section>
    </div>
  </VdModal>
  <VdModal v-model:open="clearModalOpen" title="Clear model storage?" size="md">
    <p>
      This removes Cache Storage / IndexedDB / local markers this chat stored for
      <strong>this site only</strong>. The next load may download again.
    </p>
    <ul>
      <li>Chat model files from the retained catalog</li>
      <li>The chat-owned LiteRT cache</li>
      <li>Dictation, neural voice, voice detector models and preset voice data</li>
      <li>Local “model cached” markers</li>
    </ul>
    <template #footer>
      <VdButton variant="secondary" @click="clearModalOpen = false">Cancel</VdButton>
      <VdButton variant="danger" @click="clearModelStorage">Clear storage</VdButton>
    </template>
  </VdModal>
</template>

<style scoped>
.wwl-checked-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.wwl-conversation-panel {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}
.wwl-ai-voice-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.wwl-conversation-review {
  display: grid;
  gap: 0.5rem;
}
.wwl-ai-diagnostics summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.wwl-ai-diagnostics[open] {
  display: grid;
  gap: 0.75rem;
}
.wwl-ai-context-note {
  padding: 0 1.25rem;
  font-size: 0.85rem;
}
.wwl-ai-chat-wrap {
  width: 100%;
  position: relative;
}

.wwl-ai-load-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
  background: color-mix(in srgb, var(--bg-primary, #fff) 72%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: all;
}

.wwl-ai-load-overlay-card {
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.wwl-ai-load-overlay-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.wwl-ai-capacity-note {
  margin: 0.55rem 0 0;
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-radius: var(--radius-sm, 0.5rem);
  border: 1px solid var(--vd-color-warning, #f59e0b);
  background: color-mix(in srgb, var(--vd-color-warning, #f59e0b) 12%, transparent);
  color: var(--text-primary);
  font-size: 0.85rem;
  line-height: 1.4;
}

.wwl-ai-freeze-hint {
  margin: 0.55rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.wwl-ai-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.65rem 0.85rem;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-color);
}

.wwl-ai-header-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--color-primary);
}

.wwl-ai-title {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.wwl-ai-header-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.wwl-ai-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-muted);
}

.wwl-ai-status-dot[data-tone='ok'] {
  background: var(--vd-color-success, #22c55e);
}
.wwl-ai-status-dot[data-tone='warn'] {
  background: var(--vd-color-warning, #f59e0b);
}
.wwl-ai-status-dot[data-tone='danger'] {
  background: var(--vd-color-danger, #ef4444);
}

.wwl-ai-setup {
  padding: 1.25rem 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: stretch;
}

.wwl-ai-setup-icon {
  font-size: 2.5rem;
  color: var(--color-primary);
  align-self: center;
}

.wwl-ai-setup-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.wwl-ai-setup-col,
.wwl-ai-storage-panel,
.wwl-ai-system-info {
  flex: 1 1 16rem;
  min-width: 0;
}

.wwl-ai-storage-panel,
.wwl-ai-system-info {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  padding: 0.85rem;
}

.wwl-ai-storage-title {
  font-weight: 650;
  margin-bottom: 0.45rem;
  color: var(--text-primary);
}

.wwl-form-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.wwl-ai-model-select {
  width: 100%;
  padding: 0.55rem 0.65rem;
  /* Keep padding-right room for the vd3 native-select chevron. */
  padding-right: calc(0.65rem + var(--vd-select-arrow-size, 16px) + 0.5rem);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  /* Use background-color only — `background` shorthand resets
     background-repeat/size/position and tiles the vd3 chevron SVG
     when dark-theme select:focus re-applies background-image alone. */
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.wwl-ai-note,
.wwl-ai-fineprint {
  margin: 0.45rem 0 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.wwl-ai-cache-badges,
.wwl-ai-compat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.wwl-ai-mini-badge {
  font-size: 0.7rem;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border-color);
  /* Filled chip so muted labels stay readable on dark glass cards. */
  background: var(--bg-secondary, var(--vd-bg-secondary));
  color: var(--text-primary, var(--vd-text-primary));
}

.wwl-ai-mini-badge[data-cached='1'],
.wwl-ai-mini-badge[data-state='native'] {
  border-color: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.55);
  background: rgba(var(--vd-color-success-rgb, 34, 197, 94), 0.14);
  color: var(--vd-color-success, #22c55e);
}

.wwl-ai-mini-badge[data-state='fallback'] {
  border-color: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.55);
  background: rgba(var(--vd-color-warning-rgb, 245, 158, 11), 0.14);
  color: var(--vd-color-warning, #f59e0b);
}

.wwl-ai-mini-badge[data-state='unsupported'],
.wwl-ai-mini-badge[data-state='unavailable'] {
  border-color: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.55);
  background: rgba(var(--vd-color-danger-rgb, 239, 68, 68), 0.14);
  color: var(--vd-color-danger, #ef4444);
}

.wwl-ai-mini-badge[data-state='experimental'] {
  border-color: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.55);
  background: rgba(var(--vd-color-info-rgb, 59, 130, 246), 0.14);
  color: var(--vd-color-info, #3b82f6);
}

.wwl-ai-storage-meter {
  margin-top: 0.45rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--bg-tertiary, var(--bg-primary));
  overflow: hidden;
}

.wwl-ai-storage-meter-fill {
  height: 100%;
  background: var(--color-primary);
}

.wwl-ai-setup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.wwl-ai-progress {
  display: grid;
  gap: 0.4rem;
}

.wwl-ai-error {
  margin: 0;
  color: var(--vd-color-danger, #ef4444);
  font-size: 0.88rem;
}

.wwl-ai-chat-interface {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.wwl-ai-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.wwl-ai-toolbar .wwl-ai-model-select {
  flex: 1 1 14rem;
}

.wwl-ai-messages {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.wwl-ai-message {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  padding: 0.75rem 0.9rem;
}

.wwl-ai-message[data-role='user'] {
  background: color-mix(in srgb, var(--vd-color-primary) 8%, var(--bg-secondary));
}

.wwl-ai-message-role {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.wwl-ai-message-body {
  color: var(--text-primary);
  line-height: 1.55;
  font-size: 0.95rem;
}

.wwl-ai-empty {
  color: var(--text-muted);
  text-align: center;
  margin: auto;
}

.wwl-ai-form {
  border-top: 1px solid var(--border-color);
  padding: 0.85rem 1rem 1rem;
  display: grid;
  gap: 0.55rem;
}

.wwl-ai-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 3rem;
  max-height: min(10rem, 20dvh);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 0.7rem 0.8rem;
  font: inherit;
}

.wwl-ai-form-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
  justify-content: flex-end;
}

.wwl-ai-workspace-host {
  width: 100%;
  min-width: 0;
}
.wwl-ai-chat-wrap {
  height: var(--wwl-chat-height, calc(100dvh - 12rem));
  min-height: 320px;
  display: flex;
  padding: 0;
  overflow: hidden;
}
.wwl-ai-chat-primary {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.wwl-ai-chat-wrap :deep(> .vd-card-body) {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
}
.wwl-ai-header-left {
  flex: 1 1 12rem;
}
.wwl-ai-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
}
.wwl-ai-header-actions {
  grid-column: 1 / -1;
}
.wwl-ai-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wwl-ai-header-left {
  min-width: 0;
}
.wwl-ai-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.wwl-ai-header-actions :deep(.vd-btn) {
  font-size: 0.8rem;
  padding: 0.45rem 0.65rem;
  min-height: 2.25rem;
}
.wwl-ai-live-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  padding: 0.45rem 0.85rem;
  font-size: 0.83rem;
  line-height: 1.5;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
  box-sizing: border-box;
  min-height: calc(max(1.5em, 1.5rem) + 0.9rem + 1px);
}
.wwl-ai-settings-layout {
  container: wwl-settings / inline-size;
}
.wwl-ai-settings-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem 1.75rem;
  align-items: start;
}
@supports not (container-type: inline-size) {
  @media (min-width: 760px) {
    .wwl-ai-settings-columns {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
}
@container wwl-settings (min-width: 40rem) {
  .wwl-ai-settings-columns {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.wwl-ai-settings-column {
  display: grid;
  gap: 1.25rem;
  min-width: 0;
}
.wwl-ai-settings-layout h4 {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}
.wwl-ai-settings-layout select {
  width: 100%;
  min-width: 0;
  text-overflow: ellipsis;
}
.wwl-ai-settings-layout :deep(p),
.wwl-ai-settings-layout :deep(label) {
  overflow-wrap: anywhere;
}
.wwl-ai-settings-layout .wwl-ai-setup-grid {
  display: block;
}
.wwl-ai-settings-layout .wwl-ai-setup-col {
  min-width: 0;
  display: grid;
  gap: 0.65rem;
}
.wwl-ai-settings-layout .wwl-ai-setup-actions {
  padding: 0.65rem 0;
  display: flex;
  flex-wrap: wrap;
}
.wwl-ai-settings-layout .wwl-ai-diagnostics {
  margin: 0.4rem 0;
}
.wwl-ai-settings-clear {
  min-width: 0;
}
.wwl-ai-settings-separator {
  border: 0;
  border-top: 1px solid var(--border-color, var(--vd-border-color));
  margin: 1.25rem 0;
}
.wwl-ai-settings-layout .wwl-ai-storage-panel {
  margin-bottom: 0.75rem;
}
/* VdModal has no max-height prop. Cap this dialog only so Storage can unfold
   without the panel leaving the viewport; the body scrolls, the header stays. */
:global(.wwl-ai-settings-modal.vd-modal) {
  overflow: hidden;
}
:global(.wwl-ai-settings-modal .vd-modal-panel) {
  max-height: min(
    90dvh,
    calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
  );
  overflow: hidden;
}
:global(.wwl-ai-settings-modal .vd-modal-header) {
  flex-shrink: 0;
}
:global(.wwl-ai-settings-modal .vd-modal-body) {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
@media (width <= 575.98px) {
  :global(.wwl-ai-settings-modal .vd-modal-panel) {
    max-height: min(
      90dvh,
      calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
    );
  }
}
.wwl-ai-form {
  flex: 0 0 auto;
  padding: 0.65rem 0.85rem;
}
.wwl-ai-form-meta :deep(.wwl-chat-speech) {
  margin-right: auto;
}
.wwl-ai-conversation-review {
  flex-shrink: 0;
}
.wwl-conversation-review {
  padding: 0.75rem 0.85rem;
  max-height: 35%;
  overflow: auto;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
}
.wwl-ai-chat-interface > .wwl-ai-error,
.wwl-ai-chat-interface > .wwl-ai-note {
  padding: 0.3rem 0.85rem;
  max-height: 5rem;
  overflow: auto;
  flex-shrink: 0;
}
.wwl-ai-empty {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  max-width: 28rem;
  padding: 1rem;
}
.wwl-ai-empty h4,
.wwl-ai-empty p {
  margin: 0;
}
.wwl-ai-message {
  min-width: 0;
  overflow-wrap: anywhere;
}
.wwl-ai-message-body :deep(pre) {
  max-width: 100%;
  overflow: auto;
}
@media (max-width: 600px) {
  .wwl-ai-header {
    gap: 0.45rem;
  }
  .wwl-ai-header-status {
    font-size: 0.72rem;
  }
  .wwl-ai-header-actions {
    width: 100%;
  }
  .wwl-ai-header-actions :deep(.vd-btn) {
    font-size: 0.72rem;
    padding: 0.35rem 0.45rem;
  }
  .wwl-ai-title {
    font-size: 0.82rem;
  }
  .wwl-ai-input {
    font-size: 1rem;
  }
  .wwl-ai-messages {
    padding: 0.65rem;
  }
  .wwl-ai-form-meta {
    gap: 0.3rem;
  }
  .wwl-ai-form-meta :deep(.vd-btn) {
    font-size: 0.75rem;
  }
}
</style>
