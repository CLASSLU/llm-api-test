<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { state, loadFeedback, voteFeedback, submitCustomFeedback } from '../store';

const draft = ref('');
const category = ref('misjudge');
const submitError = ref('');
const submitting = ref(false);

onMounted(() => loadFeedback());

const items = computed(() => state.feedbackItems);

function catLabel(id: string): string {
  return state.feedbackCategories.find((c: any) => c.id === id)?.label ?? '其他';
}

async function submit() {
  submitError.value = '';
  submitting.value = true;
  const err = await submitCustomFeedback(category.value, draft.value);
  submitting.value = false;
  if (err) submitError.value = err;
  else draft.value = '';
}
</script>

<template>
  <div>
    <p class="desc" style="margin-bottom:14px">
      选一个分类，写下你的反馈。所有反馈向全体访客公开，按 👍 票数从高到低排列；同一项每人一票，再点取消。
    </p>

    <div class="panel" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <button
          v-for="c in state.feedbackCategories"
          :key="c.id"
          type="button"
          class="preset-chip"
          :class="{ active: category === c.id }"
          :title="c.hint"
          @click="category = c.id"
        >{{ c.label }}</button>
      </div>
      <textarea
        v-model="draft"
        rows="3"
        maxlength="200"
        placeholder="比如：希望增加多轮对话的长上下文压力测试……（最多 200 字）"
        class="fb-textarea"
      ></textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <button class="btn" :disabled="submitting || !draft.trim()" @click="submit">{{ submitting ? '提交中…' : '发布' }}</button>
        <span v-if="submitError" style="color:var(--err);font-size:12px">{{ submitError }}</span>
        <span style="font-size:11.5px;color:var(--muted)">{{ draft.trim().length }}/200</span>
      </div>
    </div>

    <div class="panel">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">
        💬 全部反馈（{{ items.length }}）
      </div>
      <div v-if="!items.length" style="font-size:12.5px;color:var(--muted)">还没有反馈，来抢沙发。</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div v-for="item in items" :key="item.id" class="fb-row">
          <span class="fb-cat">{{ catLabel(item.category) }}</span>
          <span class="fb-text">{{ item.text }}</span>
          <button
            class="btn ghost"
            :class="{ 'fb-liked': item.mine }"
            :disabled="state.feedbackVoting === item.id"
            @click="voteFeedback(item.id)"
          >👍 {{ item.likes }}</button>
        </div>
      </div>
    </div>
  </div>
</template>