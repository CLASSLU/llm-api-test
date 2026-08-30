<script setup lang="ts">
import { computed } from 'vue';
import { state, toggleTheme, statuses } from './store';
import BrandMark from './components/BrandMark.vue';
import ChannelView from './views/ChannelView.vue';
import TestsView from './views/TestsView.vue';
import ReportView from './views/ReportView.vue';
import FeedbackView from './views/FeedbackView.vue';

const navItems = [
  { id: 'channel', icon: '🛡️', label: '渠道与安全' },
  { id: 'tests', icon: '🧪', label: '能力测试' },
  { id: 'report', icon: '📋', label: '测试报告' },
  { id: 'feedback', icon: '💌', label: '意见反馈' },
] as const;

const pageTitle = computed(() => ({ channel: '渠道与安全', tests: '能力测试', report: '测试报告', feedback: '意见反馈' }[state.page] as string));
const pageSub = computed(() => ({
  channel: '配置待测渠道；你的凭据安全由设计保证。',
  tests: '单项精测或一键全面体检，实时查看进度。',
  report: '汇总全部结果，一键导出 Markdown / JSON。',
  feedback: '投票选出你最希望的改进方向，票数高的优先做。',
}[state.page] as string));

const hasResults = computed(() =>
  state.speedResult || state.inputResult || state.outputResult || state.svgResult || state.candyResult,
);
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <BrandMark />
        <div class="name">LLM 渠道<span>体检</span></div>
      </div>
      <nav>
        <div
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ active: state.page === item.id }"
          @click="state.page = item.id"
        >
          <span>{{ item.icon }}</span>{{ item.label }}
          <span v-if="item.id === 'tests' && state.suiteRunning" class="nav-badge">…</span>
          <span v-else-if="item.id === 'report' && hasResults" class="nav-badge">{{ [state.speedResult, state.inputResult, state.outputResult, state.svgResult, state.candyResult].filter(Boolean).length }}</span>
        </div>
      </nav>
      <div class="foot">
        <div class="theme-row">
          <span>{{ state.theme === 'dark' ? '🌙 深色' : '☀️ 浅色' }}</span>
          <label class="switch">
            <input type="checkbox" :checked="state.theme === 'light'" @change="toggleTheme" />
            <span class="track"></span><span class="thumb"></span>
          </label>
        </div>
        <div class="privacy-chip">
          🔒 Key 仅存于本浏览器<br />
          Worker 内存转发 · 不落盘不进日志<br />
          开源可审计，支持自部署
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="page-head">
        <div class="topbar-actions">
          <span class="key-chip" :class="{ configured: state.channel.apiKey && state.channel.model }">
            <span class="dot"></span>{{ state.channel.apiKey && state.channel.model ? '已就绪 · ' + (state.channel.model || '') : '未配置渠道' }}
          </span>
        </div>
        <h1>{{ pageTitle }}</h1>
        <p class="sub">{{ pageSub }}</p>
      </div>

      <ChannelView v-show="state.page === 'channel'" />
      <TestsView v-show="state.page === 'tests'" />
      <ReportView v-if="state.page === 'report'" />
      <FeedbackView v-if="state.page === 'feedback'" />
    </main>
  </div>
</template>
