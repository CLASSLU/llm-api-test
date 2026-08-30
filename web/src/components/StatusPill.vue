<script setup lang="ts">
import type { Status } from '../store';
const texts: Record<Status, string> = { idle: '待测试', running: '测试中', done: '已完成', error: '失败' };
defineProps<{ status: Status }>();
</script>

<template>
  <span class="status-pill" :class="status">{{ texts[status] }}</span>
</template>
