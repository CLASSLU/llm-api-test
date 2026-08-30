<script setup lang="ts">
defineProps<{ value: number | null; max?: number }>();
</script>

<template>
  <div class="meter"><div :style="{ width: `${Math.min(100, ((value ?? 0) / (max ?? 100)) * 100)}%` }"></div></div>
</template>
