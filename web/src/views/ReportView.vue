<script setup lang="ts">
import { computed } from 'vue';
import { state, reportRows, overallScore, buildMarkdown, download } from '../store';
import MeterBar from '../components/MeterBar.vue';

const scoredCount = computed(() => reportRows.value.filter((r) => r.score !== null).length);

const compact = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

const stats = computed(() => [
  { icon: '📥', label: '实测最大输入', value: compact(state.inputResult?.maxSafeTokens), unit: 'tok', warn: state.inputResult?.echoVerified === false },
  { icon: '📤', label: '实测最大输出', value: compact(state.outputResult?.achievedCompletionTokens), unit: 'tok', warn: state.outputResult?.tokenReportMismatched ?? false },
  { icon: '🧵', label: '最大并发', value: compact(state.concurrencyResult?.maxConcurrentOk), unit: '路', warn: false },
  { icon: '⚡', label: '输出吞吐', value: state.speedResult ? state.speedResult.tokensPerSecond.toFixed(1) : '—', unit: 'tok/s', warn: false },
]);

function copyMd() {
  navigator.clipboard.writeText(buildMarkdown());
}
</script>

<template>
  <div>
    <div v-if="overallScore === null" class="empty-hint">
      📋 还没有任何测试数据<br /><br />
      前往「能力测试」跑几项测试，或点「一键全面体检」，报告会自动出现在这里。
    </div>
    <template v-else>
      <div class="report-hero">
        <div class="score-ring" :style="{ '--pct': overallScore }">
          <div>
            <div class="score-num">{{ overallScore }}</div>
            <div class="score-cap">/ 100 综合得分</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">
          已测 {{ scoredCount }}/{{ reportRows.length }} 项 · {{ scoredCount === reportRows.length ? '全部完成' : '部分项目待测（未测项计0分）' }}
        </div>
        <h2>{{ state.channel.model || '未配置模型' }}</h2>
        <div class="sub" style="color:var(--muted);font-size:12.5px">{{ state.channel.baseUrl }}</div>
      </div>
      <div class="stat-band">
        <div v-for="st in stats" :key="st.label" class="stat" :class="{ warn: st.warn }" :title="st.warn ? (st.label === '实测最大输入' ? '口令未回显，结果仅供参考' : '渠道上报用量与实测不符') : ''">
          <div class="stat-val">{{ st.value }}<span class="stat-unit">{{ st.unit }}</span></div>
          <div class="stat-label">{{ st.icon }} {{ st.label }}{{ st.warn ? ' ⚠' : '' }}</div>
        </div>
      </div>
      <div class="report-rows">
        <div v-for="r in reportRows" :key="r.name" class="rrow">
          <div class="nm"><span>{{ r.icon }}</span>{{ r.name }}</div>
          <MeterBar :value="r.score" :max="r.maxScore" />
          <div class="val">{{ r.summary }}</div>
        </div>
      </div>
      <table class="rtable">
        <thead>
          <tr><th>项目</th><th style="text-align:right;width:80px">得分</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in reportRows" :key="r.name">
            <td>{{ r.icon }} {{ r.name }}</td>
            <td style="text-align:right">{{ r.score !== null ? `${r.score}/${r.maxScore}` : '—' }}</td>
            <td style="color:var(--muted)">{{ r.summary }}</td>
          </tr>
        </tbody>
      </table>
      <div class="export-bar">
        <button class="btn ghost" @click="copyMd">复制 Markdown</button>
        <button class="btn ghost" @click="download(`llm-report-${Date.now()}.md`, buildMarkdown(), 'text/markdown')">下载 .md</button>
        <button class="btn ghost" @click="download(`llm-report-${Date.now()}.json`, JSON.stringify({ channel: state.channel.baseUrl, model: state.channel.model, time: new Date().toISOString(), rows: reportRows }, null, 2), 'application/json')">下载 .json</button>
      </div>
    </template>
  </div>
</template>
