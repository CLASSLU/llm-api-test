# LLM API 渠道体检 🩺

市面上的 LLM API 渠道鱼龙混杂：上下文虚标、输出缩水、拿旧权重冒充新版……
这个工具让你把渠道放进"体检仪"，用可验证的手段看清它的真实能力与真伪。

- 在线实例：<https://llmtest.luyuanlab.eu.org>
- 技术栈：Vue 3 · Hono · Cloudflare Workers · Vitest

## 功能总览

| 能力卡片 | 回答的问题 | 机制要点 |
|---|---|---|
| ⚡ 响应速度 | 这渠道快不快？ | 流式测量 TTFB / 总耗时 / tokens 吞吐 |
| 🧵 最大并发 | 同时能压几路？ | 1→64 阶梯并发加压，全过才升档；档间歇口气避开 RPM 误伤 |
| 📥 最大输入 | 宣称的上下文是真的吗？ | 联网查官方宣称值贴榜验证，失败自动向下二分出真实上限；头尾口令回显防静默截断 |
| 📤 最大输出 | 单次能吐多少？ | `max_tokens` 直接拉满问渠道要，拦不住就流到底；渠报 usage 与实测不符会标"可疑" |
| 🎨 SVG 创作 | 会画鹈鹕骑自行车吗？ | 结构校验 + 元素丰富度启发式 + **用户点选自评** |
| 🍬 糖果问题 | 推理水平在第几梯队？ | 经典最坏情况抽屉原理题（21 高级 / 29 常见错误） |
| 📚 知识库截至日期 | 背后是不是真这版？ | Agent 联网考古新旧版时间差窗口，逐题判决掉包行为 |
| 🚀 一键体检 + 📋 报告 | 全都懒得点？ | 顺序执行全部测试，汇总评分环，导出 Markdown / JSON |


## 安全模型 🔒

- API Key 仅存于你的浏览器；不勾选「记住」则仅本次会话有效
- Worker 只在内存中转发请求：**无数据库、无落盘、日志不含 Key**
- 项目开源 + 可一键部署自有实例，信任不必交给任何第三方

界面上的「你的 Key 的安全旅程」四步卡片即为该模型的用户侧呈现。

## 本地开发

```bash
npm install
npm run build          # 构建前端到 dist/client
npm run dev:worker     # http://127.0.0.1:8787（Worker 同时托管前端）
npm run dev:web        # 前端热更新（/api 自动代理到 8787）
npm test               # 单元/集成测试（内置 mock OpenAI 服务）
```

本地密钥放 `.dev.vars`（已 gitignore）：

```ini
TAVILY_API_KEY=tvly-dev-…  # 知识截止测试的联网能力
RESEARCH_BASE_URL=https://integrate.api.nvidia.com/v1
RESEARCH_API_KEY=nvapi-…      # 巡检员/裁判模型的 Key
RESEARCH_MODEL=nvidia/nemotron-3-super-120b-a12b  # 知识截止测试的巡检员/裁判模型
```

## 部署到 Cloudflare

```bash
npx wrangler login
npm run deploy           # 或 npx wrangler deploy
```

可选增强：

```bash
# 自定义域名（需该域已在你的 CF 账户），参考 wrangler.jsonc：
"routes": [{ "pattern": "llmtest.example.com", "custom_domain": true }]

npx wrangler secret put TAVILY_API_KEY

npx wrangler secret put RESEARCH_BASE_URL
npx wrangler secret put RESEARCH_API_KEY
npx wrangler secret put RESEARCH_MODEL          # 巡检员模型，如 deepseek-ai/deepseek-v4-pro-0813
```

> 🤖 整个系统只内置一个 AI——上面的巡检员。它身兼两职：
> ① 知识截止测试的联网时间线考古　② 给被测模型的答卷判卷　③ 联网检索官方上下文/输出上限宣称。
> 未配置时相关功能自动退化为无需联网的启发式判分。

## Agent 与数据保鲜

| 数据 | 维护方式 |
|---|---|
| 📚 出题考古 | 无库存——每次运行现查全网时间线考古，题随世界走，天然零维护 |

判定哲学：我们假设大模型很少诚实拒答，因此动态事件一律携带"知情专名"作为客观判据——**答对才算数**。

## 测试与贡献

- `test/unit.test.ts` 错误分类等纯函数
- `test/integration.test.ts` 通过 Hono app 全链路 + mock OpenAI 服务

欢迎 PR：新增厂商预设芯片（`ChannelView.vue` 的 `PROVIDERS`）、新模型注册表条目、更好的考古与判卷提示词，都是十分钟内能完成的高价值改动。

## License

[MIT](./LICENSE)