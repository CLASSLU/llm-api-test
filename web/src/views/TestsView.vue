<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { state, statuses, runSpeed, runConcurrencyTest, runInputProbe, runOutputProbe, runSvgTest, rateSvg, SVG_RATING_LABELS, type SvgUserRating, runCandyTest, runVersionCheck, runSuite } from '../store';
import StatusPill from '../components/StatusPill.vue';
import MeterBar from '../components/MeterBar.vue';

function svgDataUri(svg: string): string {
  let safe = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (!/xmlns\s*=/.test(safe)) {
    safe = safe.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(safe)}`;
}
const logBox = ref<HTMLElement | null>(null);
watch(
  () => state.logs.length,
  async () => {
    await nextTick();
    const el = logBox.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
defineExpose({});
</script>

<template>
  <div>
    <div class="suite-banner">
      <div class="txt">
        <b>🚀 一键全面体检</b>
        <span>自动依次执行全部七项测试，完成后生成综合报告。</span>
      </div>
      <button class="btn big" :disabled="state.suiteRunning || !state.channel.apiKey || !state.channel.model" @click="runSuite">
        {{ state.suiteRunning ? '体检进行中…' : '开始体检' }}
      </button>
    </div>

    <div class="grid-tests">
      <!-- Speed -->
      <div class="tcard" :style="{ '--card-accent': 'var(--speed)' }">
        <div class="head"><span class="icon">⚡</span><h3>响应速度</h3></div>
        <p class="desc">流式请求测量首字延迟与吐字速度，是体验最直观的指标。</p>
        <div v-if="state.statuses.speed === 'running'" class="shimmer"></div>
        <div v-else-if="state.speedResult" class="mini-stats">
          <div class="ms"><div class="k">TTFB</div><div class="v">{{ state.speedResult.ttfbMs }} ms</div></div>
          <div class="ms"><div class="k">总耗时</div><div class="v">{{ state.speedResult.totalMs }} ms</div></div>
          <div class="ms"><div class="k">吞吐</div><div class="v">{{ state.speedResult.tokensPerSecond?.toFixed(1) ?? '-' }} t/s</div></div>
        </div>
        <MeterBar v-if="state.speedResult" :value="Math.max(0, 100 - state.speedResult.ttfbMs / 30)" />
        <div class="foot">
          <StatusPill :status="statuses.speed" />
          <button class="btn" :disabled="statuses.speed === 'running' || !state.channel.apiKey || !state.channel.model" @click="runSpeed">测速</button>
        </div>
      </div>

      <!-- Concurrency -->
      <div class="tcard" style="--card-accent:#8b5cf6">
        <div class="head"><span class="icon">🧵</span><h3>最大并发</h3></div>
        <p class="desc">按 1→2→4→8→…→64 阶梯同时压住同一个小请求，全过才升档；失败即停，区分 429 限流与其它错误。档位之间歇口气，避免把 RPM 限流误当并发上限。</p>
        <template v-if="state.concurrencyResult && state.statuses.concurrency !== 'running'">
          <div class="meter-label">
            <span>实测并发上限{{ state.concurrencyResult.capped ? '（未探到顶）' : '' }}</span>
            <span>{{ state.concurrencyResult.maxConcurrentOk }} 路</span>
          </div>
          <MeterBar :value="Math.min(100, Math.max(0, Math.log2(Math.max(1, state.concurrencyResult.maxConcurrentOk)) / 6 * 100))" />
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            <span
              v-for="lv in state.concurrencyResult.levels"
              :key="lv.n"
              style="font-size:11px;padding:3px 8px;border-radius:999px;background:var(--bg2)"
            >{{ lv.n }} 路 {{ lv.failed === 0 ? '✓' : `✗${lv.failed}` }}</span>
          </div>
        </template>
        <div v-if="state.statuses.concurrency === 'running'" class="shimmer"></div>
        <div class="foot">
          <StatusPill :status="statuses.concurrency" />
          <button class="btn" :disabled="statuses.concurrency === 'running' || !state.channel.apiKey || !state.channel.model" @click="runConcurrencyTest">开始压测</button>
        </div>
      </div>

      <!-- SVG -->
      <div class="tcard" :style="{ '--card-accent': 'var(--svgc)' }">
        <div class="head"><span class="icon">🎨</span><h3>鹈鹕骑自行车 · SVG</h3></div>
        <p class="desc">让模型直接画一只骑自行车的鹈鹕。考验指令遵循、结构化输出与创造力。</p>
        <template v-if="state.svgResult && state.statuses.svg !== 'running'">
          <div v-if="state.svgResult.grade.isValidSvg" class="svg-preview">
            <img :src="svgDataUri(state.svgResult.svg)" alt="模型生成的鹈鹕 SVG" />
          </div>
          <div v-else class="code-note">{{ (state.svgResult.svg || '').slice(0, 200) || '(空响应)' }}</div>
          <div class="meter-label"><span>结构合法：{{ state.svgResult.grade.isValidSvg ? '是' : '否' }} · 元素 {{ state.svgResult.grade.elementCount }}</span><span>丰富度 {{ state.svgResult.grade.richnessScore }}</span></div>
          <MeterBar :value="state.svgResult.grade.richnessScore" />
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
            <span style="font-size:12px;color:var(--muted)">🧑‍🎨 你来评分：</span>
            <button v-for="(label, key) in SVG_RATING_LABELS" :key="key" type="button" class="preset-chip" :class="{ active: state.svgResult.selfRating === key }" @click="rateSvg(key as SvgUserRating)">{{ label }}</button>
          </div>
        </template>
        <div v-if="state.statuses.svg === 'running'" class="shimmer"></div>
        <div class="foot">
          <StatusPill :status="statuses.svg" />
          <button class="btn" :disabled="statuses.svg === 'running' || !state.channel.apiKey || !state.channel.model" @click="runSvgTest">开始绘制</button>
        </div>
      </div>

      <!-- Candy -->
      <div class="tcard" :style="{ '--card-accent': 'var(--candyc)' }">
        <div class="head"><span class="icon">🍬</span><h3>糖果问题 · 抽屉原理</h3></div>
        <p class="desc">经典最坏情况推理题。答 <b>21</b> 属第一梯队；答 <b>29</b> 属第二梯队。</p>
        <div v-if="state.candyResult && state.statuses.candy !== 'running'" class="verdict-big">
          <span class="emoji">{{ ({ advanced: '🥇', close: '🥈', failed: '❌' } as Record<string, string>)[state.candyResult.grade.verdict] }}</span>
          <div>
            <div class="label">{{ ({ advanced: `答 ${state.candyResult.grade.detectedNumber} · 高级`, close: `答 ${state.candyResult.grade.detectedNumber} · 第二梯队`, failed: `答 ${state.candyResult.grade.detectedNumber ?? '?'} · 未通过` } as Record<string, string>)[state.candyResult.grade.verdict] }}</div>
            <div class="why">参考结论：正确答案应为 21</div>
          </div>
        </div>
        <template v-if="state.statuses.candy === 'running'">
          <div class="shimmer"></div>
          <div class="why" style="margin-top:6px">题目较难，推理模型可能要思考几分钟 · 已等待 {{ state.candyElapsedSec }}s</div>
        </template>
        <div class="foot">
          <StatusPill :status="statuses.candy" />
          <button class="btn" :disabled="statuses.candy === 'running' || !state.channel.apiKey || !state.channel.model" @click="runCandyTest">开始答题</button>
        </div>
      </div>

      <!-- Version check -->
      <div class="tcard" :style="{ '--card-accent': 'var(--accent-a)' }">
        <div class="head"><span class="icon">📚</span><h3>知识库截至日期测试</h3></div>
        <p class="desc">警惕掉包：渠道可能拿旧权重冒充新版。我们用「新旧版知识截止差窗口」内的大事件考它，联网取证、逐题判决。</p>
        <label class="field" style="margin:0">
          <span class="lbl">对标官模 ID（可改）</span>
          <input v-model="state.versionModelId" type="text" :placeholder="state.channel.model || 'deepseek-v4-pro-0813'" @focus="state.versionModelId = state.versionModelId || state.channel.model" />
        </label>
        <template v-if="state.versionResult && state.statuses.version !== 'running'">
          <div class="verdict-big" style="flex-wrap:wrap">
            <span class="emoji">{{ (state.versionResult.pctKnown ?? 0) >= 80 ? '🏅' : (state.versionResult.pctKnown ?? 0) >= 50 ? '🤨' : '🚨' }}</span>
            <div>
              <div class="label">{{ state.versionResult.verdictLabel }}</div>
              <div class="why">知情率 {{ state.versionResult.pctKnown }}% · 窗口 {{ state.versionResult.oldCutoff ?? '?' }} → {{ state.versionResult.newCutoff ?? '?' }} · 判分{{ state.versionResult.usedJudgeModel ? '：裁判模型' : '：关键词启发式' }}</div>
            </div>
          </div>
          <table style="width:100%;font-size:11px;color:var(--muted);border-collapse:collapse">
            <tr><td>事件</td><td style="width:64px;text-align:center">判定</td></tr>
            <tr v-for="(r, i) in state.versionResult.rows" :key="i" style="border-top:1px solid var(--border)">
              <td style="padding:3px 4px 3px 0">{{ r.title }}</td>
              <td style="text-align:center"><b :style="{ color: r.judgeKind === 'known' ? 'var(--ok)' : r.judgeKind === 'fabricated' ? 'var(--err)' : 'var(--warn)' }">{{ ({ known: '知情', refused: '拒答', fabricated: '编造', unknown: '存疑' } as Record<string,string>)[r.judgeKind] }}</b></td>
            </tr>
          </table>
        </template>
        <div v-if="state.statuses.version === 'running'" class="shimmer"></div>
        <div class="foot">
          <StatusPill :status="statuses.version" />
          <button class="btn" :disabled="statuses.version === 'running' || !state.channel.apiKey || !state.channel.model" @click="runVersionCheck()">开始测试</button>
        </div>
      </div>

      <!-- Input probe -->
      <div class="tcard" :style="{ '--card-accent': 'var(--inputc)' }">
        <div class="head"><span class="icon">📥</span><h3>最大输入探测</h3></div>
        <p class="desc">联网查官方宣称的上下文，一次性塞满验证；不够就自动向下二分实测。首尾口令回显，防渠道静默截断。</p>
        <template v-if="state.inputResult && state.statuses.input !== 'running'">
          <div class="meter-label"><span>实测可用输入{{ state.inputResult.inconclusive ? '（下界·探测被错误中断）' : '' }}{{ state.inputResult.echoVerified === false ? ' · ⚠ 口令未回显，结果仅供参考' : '' }}{{ state.inputResult.claim ? ` · 宣称 ${state.inputResult.claim.toLocaleString()}（${state.inputResult.claimSource}）` : '' }}</span><span>{{ state.inputResult.maxSafeTokens?.toLocaleString() ?? '未通过' }} tok</span></div>
          <MeterBar :value="Math.min(100, Math.max(0, Math.log2(Math.max(1, state.inputResult.maxSafeTokens ?? 0) / 1024) / 10 * 100))" />
          <details>
            <summary style="cursor:pointer;font-size:11.5px;color:var(--muted)">探测记录（{{ state.inputResult.attempts.length }} 条）· 消耗约 {{ state.inputResult.spentApprox?.toLocaleString() }} tok</summary>
            <table style="width:100%;font-size:11px;color:var(--muted);border-collapse:collapse;margin-top:6px">
              <tr><td style="text-align:right;padding:2px 6px">目标</td><td>结果</td><td>渠道实测 prompt</td></tr>
              <tr v-for="(a, i) in state.inputResult.attempts" :key="i" style="border-top:1px solid var(--border)">
                <td style="text-align:right;padding:2px 6px">{{ a.targetTokens.toLocaleString() }}</td>
<td><span :style="{ color: a.ok && a.echoOk !== false ? 'var(--ok)' : a.ok ? 'var(--warn)' : ['context_limit', 'truncation_suspect'].includes(a.errorKind) ? 'var(--err)' : 'var(--warn)' }">{{ a.ok ? (a.echoOk === false ? '⚠ 收下·口令未回显' : '✓ 通过') : a.errorKind === 'context_limit' ? '✗ 超限' : a.errorKind === 'truncation_suspect' ? '✗ 实收偏少(疑似截断)' : '⚠ ' + (a.errorKind ?? '?') }}{{ a.detail ? ' · ' + a.detail : '' }}</span></td>
                <td>{{ a.measuredPromptTokens?.toLocaleString() ?? '-' }}</td>
              </tr>
            </table>
          </details>
        </template>
        <div v-if="state.statuses.input === 'running'" class="shimmer"></div>
        <div class="foot">
          <StatusPill :status="statuses.input" />
          <button class="btn" :disabled="statuses.input === 'running' || !state.channel.apiKey || !state.channel.model" @click="runInputProbe()">开始探测</button>
        </div>
      </div>

      <!-- Output probe -->
      <div class="tcard" :style="{ '--card-accent': 'var(--outputc)' }">
        <div class="head"><span class="icon">📤</span><h3>最大输出探测</h3></div>
        <p class="desc">直接把 max_tokens 拉满问渠道要，流式实测真实输出上限；渠报 usage 与实测不符会标记可疑。</p>
        <template v-if="state.outputResult && state.statuses.output !== 'running'">
          <div class="meter-label"><span>实测输出 {{ state.outputResult.achievedCompletionTokens }} tok{{ state.outputResult.tokenReportMismatched ? ` · 渠报 ${state.outputResult.reportedCompletionTokens}（可疑）` : '' }}{{ state.outputResult.specClaimedMaxOutput ? ` · 宣称 ${state.outputResult.specClaimedMaxOutput.toLocaleString()}` : '' }}</span><span>{{ state.outputResult.finishedByStop ? '自然停止' : state.outputResult.timedOut ? '超时（已保留实测）' : '压到上限' }}</span></div>
          <MeterBar :value="Math.min(100, Math.max(0, Math.log2(Math.max(1, state.outputResult.achievedCompletionTokens ?? 0) / 1024) / 7 * 100))" />
        </template>
        <div v-if="state.statuses.output === 'running'" class="shimmer"></div>
        <div class="foot">
          <StatusPill :status="statuses.output" />
          <button class="btn" :disabled="statuses.output === 'running' || !state.channel.apiKey || !state.channel.model" @click="runOutputProbe()">开始探测</button>
        </div>
      </div>
    </div>

    <details class="panel" open style="margin-top:20px">
      <summary style="cursor:pointer;font-size:14px;font-weight:600">📜 运行日志</summary>
      <pre class="logbox" ref="logBox"><template v-for="(l, i) in state.logs" :key="i">{{ l }}&#10;</template><span v-if="!state.logs.length" style="color:#667">暂无日志</span></pre>
    </details>
  </div>
</template>