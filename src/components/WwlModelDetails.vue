<script setup>
import { computed } from 'vue';
import { getModelOption, getModelChoiceLabel } from '@wwl/wwl-ai-chat';
const props = defineProps({ modelId: { type: String, default: '' } });
const model = computed(() => getModelOption(props.modelId));
</script>
<template>
  <div v-if="model" class="wwl-model-details">
    <p>
      {{ model.purpose || model.tier }} {{ model.experimental ? 'Experimental candidate.' : '' }}
    </p>
    <p>
      {{ getModelChoiceLabel(model) }} · {{ model.precision || 'Web build' }} ·
      {{ model.license || 'See model licence' }}
    </p>
    <p v-if="model.toolCalling">
      <a :href="model.toolCalling.source" rel="noopener noreferrer"
        >Model documentation: tool calling</a
      >.
      {{
        model.capabilities?.tools
          ? model.toolCalling?.integration === 'xml'
            ? 'Tools can edit the flowchart through the XML protocol.'
            : 'Available through the Gemma integration.'
          : 'This model can read the flowchart but cannot change it.'
      }}
    </p>
    <p>
      Requires a compatible WebGPU browser.
      <template v-if="model.requires?.length"
        >This precision also requires {{ model.requires.join(', ') }}.</template
      ><template v-else>This model does not require shader-f16.</template>
    </p>
    <p v-if="model.estimatedWorkingBytes">
      Estimated working memory: {{ (model.estimatedWorkingBytes / 1e9).toFixed(1) }} GB at the
      listed context; browser RAM readings are approximate.
    </p>
    <p v-if="model.reasoning === 'required'">
      Uses required reasoning before answering; reasoning tokens count against the output limit.
    </p>
    <p v-if="model.variantOf">
      Compatibility variant of {{ model.variantOf }}. Select the precision you want before loading.
    </p>
  </div>
</template>
<style scoped>
.wwl-model-details {
  font-size: 0.85rem;
  line-height: 1.5;
}
.wwl-model-details p {
  margin: 0.3rem 0;
}
</style>
