<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { state, persistChannel, log } from '../store';

const open = ref(false);
const query = ref('');
const rootEl = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return state.models;
  return state.models.filter((m) => m.toLowerCase().includes(q));
});

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  state.channel.model = val;
  query.value = val;
  open.value = true;
}

function openAll() {
  query.value = '';
  open.value = true;
}

function choose(m: string) {
  state.channel.model = m;
  persistChannel();
  log(`已选择模型 ${m}`);
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
  if (e.key === 'Enter' && open.value && filtered.value.length === 1) {
    choose(filtered.value[0]);
  }
}

onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="rootEl" class="combobox" @keydown="onKeydown">
    <input
      type="text"
      :value="state.channel.model"
      placeholder="手填模型名，或点 ▾ 从列表选"
      autocomplete="off"
      @input="onInput"
      @focus="openAll"
      @click.stop="openAll"
    />
    <button type="button" class="cb-arrow" :class="{ up: open }" aria-label="展开模型列表" @click.stop="open ? (open = false) : openAll()">▾</button>
    <div v-if="open && state.models.length" class="cb-panel">
      <div
        v-for="m in filtered"
        :key="m"
        class="cb-item"
        :class="{ active: m === state.channel.model }"
        @mousedown.prevent="choose(m)"
      >
        {{ m }}
      </div>
      <div v-if="!filtered.length" class="cb-empty">无匹配模型</div>
    </div>
  </div>
</template>
