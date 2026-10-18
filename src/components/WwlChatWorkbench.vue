<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { VdFlowchart, FLOWCHART_DOCUMENT_VERSION } from '@vanduo-oss/vd3-flowchart';
import '@vanduo-oss/vd3-flowchart/css';
import { getModelOption } from '@wwl/wwl-ai-chat';
import WwlAiChatUI from './WwlAiChatUI.vue';
import { captureFlowchartPng } from '../lib/flowchart-capture.js';
import { readChatPreferences, saveChatPreferences } from '../lib/chat-preferences.js';
const Compare = defineAsyncComponent(() => import('./WwlCompareChat.vue'));
const localEvaluation = import.meta.env.DEV || import.meta.env.MODE === 'qa';
const Evaluate = localEvaluation
  ? defineAsyncComponent(() => import('./WwlLocalEvaluation.vue'))
  : null;
const stored = readChatPreferences();
const view = ref('chat'),
  selected = ref('gemma-4-E2B-it-web'),
  child = ref(null),
  changing = ref(false),
  flowchartRoot = ref(null),
  flowchartEditor = ref(null),
  stageEl = ref(null),
  flowchartOpen = ref(stored.flowchartOpen),
  flowchartRatio = ref(stored.flowchartRatio),
  inspectorOpen = ref(stored.inspectorOpen),
  flowchartNotice = ref(''),
  pendingLayout = ref(false),
  narrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
let dragging = false;
let media;
const flowchartDocument = ref({
  version: FLOWCHART_DOCUMENT_VERSION,
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: [],
  edges: [],
});
const flowchartEditable = computed(() => !!getModelOption(selected.value)?.capabilities?.tools);
const split = computed(() => flowchartOpen.value && !narrow.value);
const stageStyle = computed(() =>
  split.value ? { '--wwl-chat-width': `${Math.round(flowchartRatio.value * 1000) / 10}%` } : {},
);
function onMedia() {
  narrow.value = !!media?.matches;
}
function onFlowchartChange(event) {
  if (event?.document) flowchartDocument.value = event.document;
}
async function layoutFlowchart() {
  await nextTick();
  if (typeof flowchartEditor.value?.layout !== 'function') {
    pendingLayout.value = true;
    return;
  }
  try {
    flowchartEditor.value.layout('tree', { fit: true });
  } catch {
    /* An empty or not-yet-measured canvas can refuse a fit. */
  }
  pendingLayout.value = false;
}
async function onModelDocument(document) {
  flowchartNotice.value = '';
  flowchartDocument.value = {
    version: document.version || FLOWCHART_DOCUMENT_VERSION,
    viewport: document.viewport || { x: 0, y: 0, scale: 1 },
    nodes: document.nodes,
    edges: document.edges,
  };
  await layoutFlowchart();
}
function onFlowchartRejected(message) {
  flowchartNotice.value = message || 'The flowchart update was rejected.';
}
function setFlowchartOpen(open) {
  flowchartOpen.value = open;
  saveChatPreferences({ flowchartOpen: open });
}
function setInspectorOpen(open) {
  inspectorOpen.value = open;
  saveChatPreferences({ inspectorOpen: open });
}
function clampRatio(next) {
  const stage = stageEl.value;
  if (!stage) return Math.min(0.85, Math.max(0.15, next));
  const handle = stage.querySelector('.wwl-chat-splitter')?.getBoundingClientRect().width || 10;
  const available = stage.getBoundingClientRect().width - handle;
  if (available <= 0) return next;
  const min = Math.min(320, available / 2);
  const chat = Math.min(available - min, Math.max(min, next * available));
  return chat / available;
}
function applyClientX(clientX) {
  const stage = stageEl.value;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const handle = stage.querySelector('.wwl-chat-splitter')?.getBoundingClientRect().width || 10;
  const available = rect.width - handle;
  if (available <= 0) return;
  const min = Math.min(320, available / 2);
  const chat = Math.min(available - min, Math.max(min, clientX - rect.left));
  flowchartRatio.value = chat / available;
}
function onSplitterDown(event) {
  if (event.button != null && event.button !== 0) return;
  dragging = true;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onSplitterMove);
  window.addEventListener('pointerup', onSplitterUp);
  window.addEventListener('pointercancel', onSplitterUp);
  applyClientX(event.clientX);
}
function onSplitterMove(event) {
  if (!dragging) return;
  applyClientX(event.clientX);
}
function onSplitterUp() {
  if (!dragging) return;
  dragging = false;
  window.removeEventListener('pointermove', onSplitterMove);
  window.removeEventListener('pointerup', onSplitterUp);
  window.removeEventListener('pointercancel', onSplitterUp);
  saveChatPreferences({ flowchartRatio: flowchartRatio.value });
}
function onSplitterKeydown(event) {
  const step = event.shiftKey ? 0.05 : 0.02;
  let next = null;
  if (event.key === 'ArrowLeft') next = flowchartRatio.value - step;
  if (event.key === 'ArrowRight') next = flowchartRatio.value + step;
  if (event.key === 'Home') next = 0.15;
  if (event.key === 'End') next = 0.85;
  if (next == null) return;
  event.preventDefault();
  flowchartRatio.value = clampRatio(next);
  saveChatPreferences({ flowchartRatio: flowchartRatio.value });
}
async function captureFlowchart() {
  return captureFlowchartPng(flowchartRoot.value);
}
async function change(next) {
  if (changing.value || next === view.value) return;
  changing.value = true;
  try {
    if (view.value === 'chat') selected.value = child.value?.getModelId?.() || selected.value;
    await child.value?.suspend?.();
    view.value = next;
  } finally {
    changing.value = false;
  }
}
watch(flowchartOpen, (open) => {
  if (open && pendingLayout.value) void layoutFlowchart();
});
onMounted(() => {
  media = window.matchMedia('(max-width: 900px)');
  narrow.value = media.matches;
  media.addEventListener('change', onMedia);
});
onBeforeUnmount(() => {
  media?.removeEventListener('change', onMedia);
  window.removeEventListener('pointermove', onSplitterMove);
  window.removeEventListener('pointerup', onSplitterUp);
  window.removeEventListener('pointercancel', onSplitterUp);
});
</script>
<template>
  <div class="wwl-chat-workbench">
    <nav class="wwl-chat-views" aria-label="AI Chat mode">
      <button
        type="button"
        class="vd-btn"
        :class="view === 'chat' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'chat'"
        :disabled="changing"
        @click="change('chat')"
      >
        Chat</button
      ><button
        type="button"
        class="vd-btn"
        :class="view === 'compare' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'compare'"
        :disabled="changing"
        @click="change('compare')"
      >
        Compare</button
      ><button
        v-if="localEvaluation"
        type="button"
        class="vd-btn"
        :class="view === 'evaluate' ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="view === 'evaluate'"
        :disabled="changing"
        @click="change('evaluate')"
      >
        Evaluate · local
      </button>
      <button
        v-if="view === 'chat'"
        type="button"
        class="vd-btn"
        :class="flowchartOpen ? 'vd-btn-primary' : 'vd-btn-outline'"
        :aria-pressed="flowchartOpen"
        @click="setFlowchartOpen(!flowchartOpen)"
      >
        Flowchart
      </button>
    </nav>
    <p v-if="changing" role="status">Releasing model resources…</p>
    <div
      v-if="view === 'chat'"
      ref="stageEl"
      class="wwl-chat-stage"
      :class="{ 'is-split': split }"
      :style="stageStyle"
    >
      <WwlAiChatUI
        ref="child"
        :flowchart-document="flowchartOpen ? flowchartDocument : null"
        :capture-flowchart="captureFlowchart"
        @model-change="selected = $event"
        @flowchart-document="onModelDocument"
        @flowchart-rejected="onFlowchartRejected"
      />
      <div
        v-if="split"
        class="wwl-chat-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and flowchart"
        tabindex="0"
        :aria-valuenow="Math.round(flowchartRatio * 100)"
        aria-valuemin="15"
        aria-valuemax="85"
        @pointerdown="onSplitterDown"
        @pointermove="onSplitterMove"
        @pointerup="onSplitterUp"
        @pointercancel="onSplitterUp"
        @keydown="onSplitterKeydown"
      ></div>
      <section
        v-if="flowchartOpen"
        ref="flowchartRoot"
        class="wwl-flowchart-column"
        :class="{ 'is-inspector-hidden': !inspectorOpen }"
        aria-label="Flowchart canvas"
      >
        <div class="wwl-flowchart-heading">
          <p v-if="!flowchartEditable" class="wwl-flowchart-note">
            This model can read the flowchart but cannot change it.
          </p>
          <p v-if="flowchartNotice" class="wwl-flowchart-note" role="status">
            {{ flowchartNotice }}
          </p>
          <button
            type="button"
            class="vd-btn vd-btn-outline"
            :aria-pressed="inspectorOpen"
            @click="setInspectorOpen(!inspectorOpen)"
          >
            {{ inspectorOpen ? 'Hide inspector' : 'Show inspector' }}
          </button>
        </div>
        <VdFlowchart
          ref="flowchartEditor"
          class="wwl-flowchart-canvas"
          :data="flowchartDocument"
          @change="onFlowchartChange"
        />
      </section>
    </div>
    <KeepAlive v-else
      ><component :is="view === 'compare' ? Compare : Evaluate" ref="child" :model-a="selected"
    /></KeepAlive>
  </div>
</template>
<style scoped>
.wwl-chat-views {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}
.wwl-chat-views .vd-btn,
.wwl-flowchart-heading .vd-btn {
  padding: 0.4rem 0.7rem;
  font-size: 0.82rem;
}
.wwl-chat-stage {
  display: flex;
  align-items: stretch;
  min-width: 0;
}
.wwl-chat-stage > :deep(.wwl-ai-workspace-host) {
  flex: 1 1 auto;
  min-width: 0;
}
.wwl-chat-stage.is-split > :deep(.wwl-ai-workspace-host) {
  flex: 0 0 auto;
  width: var(--wwl-chat-width, 30%);
  min-width: min(320px, 100%);
}
.wwl-chat-splitter {
  flex: 0 0 0.65rem;
  margin: 0 0.2rem;
  border: 0;
  padding: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vd-border-color, #888) 75%, transparent);
  cursor: col-resize;
  touch-action: none;
}
.wwl-chat-splitter:focus-visible {
  outline: 2px solid var(--vd-color-primary, #3d8f6e);
  outline-offset: 2px;
}
.wwl-flowchart-column {
  flex: 1 1 0;
  min-width: min(320px, 100%);
  min-height: 320px;
  display: flex;
  flex-direction: column;
}
.wwl-flowchart-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}
.wwl-flowchart-canvas {
  flex: 1;
  height: calc(100dvh - 14rem);
  min-height: 320px;
}
.wwl-flowchart-note {
  margin: 0;
  font-size: 0.85rem;
}
.wwl-flowchart-column.is-inspector-hidden :deep(.vd-flowchart-panel--inspector) {
  display: none;
}
.wwl-flowchart-column.is-inspector-hidden :deep(.vd-flowchart-body) {
  grid-template-columns: 88px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
@media (max-width: 900px) {
  .wwl-chat-stage {
    flex-direction: column;
    gap: 0.75rem;
  }
  .wwl-chat-stage.is-split > :deep(.wwl-ai-workspace-host),
  .wwl-flowchart-column {
    width: auto;
    min-width: 0;
  }
}
</style>
