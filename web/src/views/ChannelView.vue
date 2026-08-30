<script setup lang="ts">
import { state, persistChannel, loadModels, log } from '../store';
import ModelPicker from '../components/ModelPicker.vue';

function saveAndCheck() {
  persistChannel();
  log('✅ 渠道配置已保存（浏览器本地）');
}

const PROVIDERS = [
  { name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', badge: 'NV', color: '#76b900' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', badge: 'AI', color: '#10a37f' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', badge: 'DS', color: '#4d6bfe' },
  { name: 'Kimi', url: 'https://api.moonshot.cn/v1', badge: 'K', color: '#1a1d24' },
  { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', badge: 'GLM', color: '#3859ff' },
  { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', badge: 'QW', color: '#615ced' },
  { name: '豆包方舟', url: 'https://ark.cn-beijing.volces.com/api/v3', badge: 'ARK', color: '#0f6cff' },
  { name: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1', badge: 'SF', color: '#7c3aed' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', badge: 'GQ', color: '#f55036' },
  { name: 'xAI Grok', url: 'https://api.x.ai/v1', badge: 'X', color: '#1a1d24' },
  { name: 'Mistral', url: 'https://api.mistral.ai/v1', badge: 'M', color: '#ff7000' },
] as const;

function applyPreset(p: (typeof PROVIDERS)[number]) {
  state.channel.baseUrl = p.url;
  persistChannel();
  log(`已选用 ${p.name} 官方端点，URL 可自由修改`);
}
</script>

<template>
  <div>
    <div class="panel">
      <h2>🔌 接入渠道</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button
          v-for="p in PROVIDERS"
          :key="p.name"
          type="button"
          class="preset-chip"
          :class="{ active: state.channel.baseUrl === p.url }"
          @click="applyPreset(p)"
        >
          <span class="pbadge" :style="{ background: p.color }">{{ p.badge }}</span>
          {{ p.name }}
        </button>
      </div>
      <label class="field">
        <span class="lbl">Base URL — OpenAI 兼容端点（点上方厂商快速填入，可自由修改）</span>
        <input v-model="state.channel.baseUrl" type="text" placeholder="https://integrate.api.nvidia.com/v1" />
      </label>
      <div class="row">
        <label class="field">
          <span class="lbl">API Key</span>
          <input v-model="state.channel.apiKey" :type="state.showKey ? 'text' : 'password'" placeholder="sk-… / nvapi-…" autocomplete="off" @change="persistChannel" />
        </label>
        <label class="field" style="max-width:230px">
          <span class="lbl">模型（从列表选或直接输入）</span>
          <ModelPicker />
        </label>
      </div>
      <div class="row" style="align-items:center;margin-top:2px">
        <button class="btn ghost" style="flex:none" @click="loadModels">🔄 拉取模型列表</button>
        <button class="btn" style="flex:none" @click="saveAndCheck">保存配置</button>
      </div>
      <div style="display:flex;gap:26px;flex-wrap:wrap;margin-top:18px">
        <label class="check-line">
          <span class="switch">
            <input v-model="state.rememberKey" type="checkbox" @change="persistChannel" />
            <span class="track"></span><span class="thumb"></span>
          </span>
          记住 Key（存本机浏览器）
        </label>
        <label class="check-line">
          <span class="switch">
            <input v-model="state.showKey" type="checkbox" />
            <span class="track"></span><span class="thumb"></span>
          </span>
          显示明文
        </label>
      </div>
    </div>

    <div class="panel">
      <h2>🛡️ 你的 Key 的安全旅程</h2>
      <div class="trust-steps">
        <div class="tstep"><b>✅ 仅存本地</b>Key 保存在你的浏览器里；不勾选“记住”则仅本次会话有效，关闭即消失。</div>
        <div class="arrow-sep">→</div>
        <div class="tstep"><b>🧠 内存转发</b>测试时 Worker 只在内存中转发请求到目标渠道。<b>不落盘、不进日志、无数据库。</b></div>
        <div class="arrow-sep">→</div>
        <div class="tstep"><b>🎯 直达渠道</b>只有你填写的目标渠道能收到这个 Key，第三方完全经手不到。</div>
        <div class="arrow-sep">→</div>
        <div class="tstep"><b>📖 可自审计</b>项目开源，支持一键部署自己的实例——安全不必信任任何人。</div>
      </div>
    </div>
  </div>
</template>
