# GitHub Pages 浏览器端 AI 架构改造方案

## 背景

当前项目在本地可以正常使用，是因为本地开发环境会启动 `server.ts`，由它提供 `/api/simulator/*` 这些接口。部署到 GitHub Pages 以后，GitHub Pages 只会托管静态前端文件，不会运行 Express 服务，所以浏览器请求 `/api/simulator/generate-questions`、`/api/simulator/start`、`/api/simulator/next-node`、`/api/simulator/analyze-personality` 和 `/api/simulator/time-travel` 时，会落到 `zhangxinyi08888-dot.github.io` 这个静态站点上，最终因为没有后端接口而失败。

本次改造目标是让项目完全适配 GitHub Pages。用户已明确表示不用考虑 API Key 暴露问题，因此可以把应用改造成纯静态前端，由浏览器直接调用 DeepSeek API。这样既能保留实时交互，也不再需要单独部署后端服务。

## 目标

- GitHub Pages 部署后的版本功能完整，不依赖额外后端。
- 保持现有用户流程、模拟体验和 AI 生成行为不变。
- 将原本 Express 接口里的业务编排迁移到浏览器端 TypeScript 服务。
- 本地开发回到简单的 Vite 模式，默认只需要 `pnpm dev`。
- API Key 直接通过 Vite 环境变量在本地或构建环境中配置，不设计页面输入和浏览器保存流程。
- 复用现有 prompt 构造、响应解析、重试和数据归一化逻辑，避免重写核心规则。

## 非目标

- 不保护浏览器端 API Key。这个风险在当前需求中明确接受。
- 不新增独立托管的 API 服务。
- 不在本次重构中替换 DeepSeek 供应商。
- 不调整主要产品交互、视觉设计或故事生成规则。
- 不重写整个应用状态模型。

## 推荐方案

采用“纯前端浏览器 AI 客户端”架构。React 前端直接调用 DeepSeek Chat Completions API，当前由 Express 暴露的五个模拟接口改为浏览器端 service 方法。`server.ts` 可以暂时保留为可选的本地兼容代码，但不再进入 GitHub Pages 生产链路。

备选方案对比：

1. 静态前端加独立 API 后端
   - 优点：API Key 不暴露，后端可以统一做限流、重试和供应商兜底。
   - 缺点：不是纯 GitHub Pages 方案，需要额外服务器或 Serverless 平台。

2. 浏览器直接调用 DeepSeek，并在页面内提供 Key 配置
   - 优点：完全兼容 GitHub Pages，不需要后端，不依赖构建配置。
   - 结论：不采用。它会增加额外配置界面和浏览器存储逻辑，对当前项目不是必要复杂度。

3. 浏览器直接调用 DeepSeek，构建时注入 `VITE_DEEPSEEK_API_KEY`
   - 优点：用户体验最简单，打开页面即可使用。
   - 缺点：Key 会被打进公开的 JS 文件里，换 Key 需要重新构建部署。当前已接受该成本和暴露风险。

推荐采用方案 3。项目只需要从 Vite 环境变量读取 Key，不需要实现页面配置入口，也不需要实现浏览器端保存、清除或替换 Key 的功能。

## 关于实时交互 API

可以做实时交互。GitHub Pages 不能运行自己的后端接口，但浏览器本身可以主动发起 HTTPS 请求。只要 DeepSeek 的接口允许跨域请求，前端就可以通过 `fetch` 直接调用它。

本项目需要封装的不是“服务器 API”，而是“浏览器端 AI 调用方法”。页面中的按钮、表单和模拟流程仍然可以保持实时交互：用户点击后，React 调用本地 service，service 构造 prompt，然后浏览器向 DeepSeek 发起请求，拿到结果后更新界面。

## 目标架构

```text
GitHub Pages
  index.html
  React UI
  浏览器端模拟服务
  浏览器端 DeepSeek 客户端
  Prompt 构造与响应归一化
  浏览器 Key 存储
        |
        | HTTPS POST /chat/completions
        v
DeepSeek API
```

GitHub Pages 版本中不能再请求 `/api/simulator/*`。所有模拟能力都应调用浏览器端 TypeScript service 方法。

## 模块设计

### `src/services/ai/deepseekBrowserClient.ts`

用途：浏览器可用的 DeepSeek 请求客户端。

职责：

- 构造 `/chat/completions` 请求。
- 从 `import.meta.env.VITE_DEEPSEEK_API_KEY` 读取 API Key。
- 保留现有“只返回 JSON”的系统提示约束。
- 保留 `response_format: { type: "json_object" }`、`thinking: { type: "disabled" }`、`temperature`、`max_tokens` 和非流式请求行为。
- 返回与现有解析逻辑兼容的 `{ text: string }`。
- 将网络失败、401/403、供应商错误、CORS 失败和响应格式异常转换成前端可识别的类型化错误。

建议 API：

```ts
export interface BrowserDeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function callDeepSeekJsonFromBrowser(
  config: BrowserDeepSeekConfig,
  prompt: string,
  fetchImpl?: typeof fetch
): Promise<{ text: string }>;
```

### `src/services/ai/env.ts`

用途：集中读取浏览器构建环境配置。

职责：

- 读取 `import.meta.env.VITE_DEEPSEEK_API_KEY`。
- 读取可选的 `VITE_DEEPSEEK_BASE_URL` 和 `VITE_DEEPSEEK_MODEL`。
- 在缺少 Key 时抛出类型化配置错误。
- 永远不要把 Key 打印到日志中。

建议 API：

```ts
export interface BrowserAiEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getBrowserAiEnv(): BrowserAiEnv;
```

### `src/services/simulation/simulationService.ts`

用途：用浏览器端函数替代原来的五个 Express 接口。

职责：

- `generateQuestions(userData)` 替代 `POST /api/simulator/generate-questions`。
- `startSimulation(userData, answers)` 替代 `POST /api/simulator/start`。
- `generateNextNode(input)` 替代 `POST /api/simulator/next-node`。
- `analyzePersonality(input)` 替代 `POST /api/simulator/analyze-personality`。
- `timeTravel(input)` 替代 `POST /api/simulator/time-travel`。
- 复用 `src/utils/questionPrompt.ts`、`src/utils/eventPrompt.ts`、`src/utils/answerFormatting.ts` 里的 prompt 相关能力。
- 复用 `src/utils/simulationResponse.ts`、`src/utils/insightResponse.ts` 和 `src/utils/simulationNodeRetry.ts` 里的响应归一化与重试逻辑。
- 保持返回结构与当前 `App.tsx` 期望一致，尽量减少 UI 层改动。

这个 service 必须是纯浏览器兼容的 TypeScript，不能引入 Express、Node `path`、`dotenv` 或 `@google/genai/node` 之类的 Node 专用 API。

### Prompt 提取

`server.ts` 里目前包含一部分重要 prompt 逻辑。实现时需要把这些接口内联 prompt 提取到浏览器安全模块中，建议放在 `src/services/simulation/prompts/` 或 `src/utils/` 下。

建议模块：

- `src/services/simulation/prompts/startSimulationPrompt.ts`
- `src/services/simulation/prompts/nextNodePrompt.ts`
- `src/services/simulation/prompts/personalityPrompt.ts`
- `src/services/simulation/prompts/timeTravelPrompt.ts`

这些函数只接收类型化输入并返回字符串，不直接调用 AI API。

### `src/App.tsx`

用途：从调用后端接口改为调用浏览器端模拟服务。

改动：

- 将 `fetch("/api/simulator/generate-questions")` 替换为 `simulationService.generateQuestions(...)`。
- 将其他所有 `/api/simulator/*` 请求替换为对应 service 方法。
- 保持现有状态流转和页面流程不变。
- 当构建环境没有配置 API Key 时，展示清晰的配置错误。
- 将 service 抛出的类型化错误映射到现有弹窗提示。

### API Key 配置方式

不新增页面配置入口。API Key 只通过项目本地或构建环境配置：

- 本地开发：在 `.env.local` 中配置 `VITE_DEEPSEEK_API_KEY`。
- 生产构建：在 `.env.production`、GitHub Actions env、或其他构建环境中配置 `VITE_DEEPSEEK_API_KEY`。
- 如果当前阶段接受 Key 暴露风险，也可以把生产 Key 直接放入项目配置文件中。
- 不实现浏览器端保存、清除、替换 Key 的交互。
- 即使没有 Key，也不阻止静态应用外壳加载；只在触发 AI 请求时给出配置错误提示。

## 构建与部署调整

### `package.json`

GitHub Pages 的生产构建应该只构建前端。

推荐 scripts：

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "server:dev": "tsx server.ts",
    "server:build": "esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "server:start": "node dist/server.cjs"
  }
}
```

`server.ts` 可以继续作为可选后端模式存在，但不能再成为 GitHub Pages 构建产物的一部分。

### GitHub Pages Workflow

工作流只需要构建静态前端并上传 `dist`。继续保留：

- `BASE_PATH: /ai-life-simulator/`
- `cp dist/index.html dist/404.html`
- `touch dist/.nojekyll`

当 `pnpm build` 不再生成 `dist/server.cjs` 后，可以移除 workflow 里针对 server bundle 的清理逻辑。

配置示例：

本地 `.env.local`：

```dotenv
VITE_DEEPSEEK_API_KEY=your_deepseek_api_key
VITE_DEEPSEEK_MODEL=deepseek-v4-flash
VITE_DEEPSEEK_BASE_URL=https://api.deepseek.com
```

GitHub Pages workflow：

```yaml
env:
  BASE_PATH: /ai-life-simulator/
  VITE_DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
  VITE_DEEPSEEK_MODEL: deepseek-v4-flash
  VITE_DEEPSEEK_BASE_URL: https://api.deepseek.com
```

如果当前阶段不关心 Key 暴露，也可以直接在仓库配置文件或 workflow env 中写入明文 Key，降低部署复杂度。

## 数据流

### 生成追问

1. 用户提交初始信息。
2. `App.tsx` 调用 `simulationService.generateQuestions(userData)`。
3. service 使用 `buildQuestionPrompt(userData)` 构造 prompt。
4. 浏览器端 DeepSeek 客户端发送 chat completion 请求。
5. service 解析 JSON 并返回 `{ questions }`。
6. UI 进入追问步骤。

### 开始模拟

1. 用户提交追问答案。
2. service 使用提取后的 prompt 逻辑构造开始模拟 prompt。
3. 浏览器端客户端调用 DeepSeek。
4. service 使用现有重试和归一化工具处理响应。
5. UI 收到 `{ initialAttributes, startNode }` 并进入模拟流程。

### 下一节点、最终洞察和时空穿越

这些流程与当前 server endpoint 行为保持一致，只是执行位置从 `server.ts` 移到 `simulationService`。service 负责 prompt 构造、AI 请求、解析、归一化和错误转换。

## 错误处理

新增一个小型错误类型或可区分联合类型：

```ts
export type AiClientErrorCode =
  | "API_KEY_MISSING"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_NETWORK_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_REQUEST_FAILED";
```

UI 映射：

- `API_KEY_MISSING`：提示检查本地或构建环境中的 `VITE_DEEPSEEK_API_KEY`。
- `AI_AUTH_FAILED`：提示用户检查 Key 是否正确。
- `AI_RATE_LIMITED`：提示稍后重试。
- `AI_NETWORK_FAILED`：沿用当前网络异常文案。
- `AI_RESPONSE_INVALID`：提示重新生成。
- `AI_REQUEST_FAILED`：展示通用 AI 失败提示并允许重试。

迁移后，App 不应继续依赖 `response.ok` 或接口返回的 `{ error }` 结构。service 应该抛出类型化错误，或返回类型化成功结果。

## 测试计划

实现前应先补充聚焦测试：

- 浏览器端 DeepSeek 客户端能构造正确 endpoint 和请求体。
- 浏览器端 DeepSeek 客户端能提取 JSON 内容，并兼容 fenced JSON。
- 环境配置读取逻辑能正确读取 `VITE_DEEPSEEK_API_KEY`、base URL 和 model。
- `simulationService.generateQuestions` 能从假请求响应中返回解析后的问题列表。
- `simulationService.startSimulation` 能对不完整节点执行重试并返回归一化结果。
- `App.tsx` 集成测试可以等 UI 测试框架引入后再补，不作为本次重构的硬性前置。

测试风格沿用项目现有的 `node:assert/strict` 和 `tsx`。

## 迁移步骤

1. 为浏览器端 DeepSeek 客户端和环境配置读取逻辑添加测试。
2. 实现浏览器端 DeepSeek 客户端和环境配置读取模块。
3. 从 `server.ts` 中提取 prompt 构造逻辑到浏览器安全模块。
4. 为每个原 endpoint 对应的 `simulationService` 方法添加测试。
5. 使用提取后的 prompt 和现有归一化工具实现 `simulationService`。
6. 更新 `App.tsx`，移除对 `/api/simulator/*` 的请求。
7. 增加缺少 `VITE_DEEPSEEK_API_KEY` 时的清晰错误提示。
8. 修改 `package.json` scripts，让 Pages 只执行 `vite build`。
9. 简化 `.github/workflows/deploy-pages.yml`，只保留静态产物部署逻辑。
10. 使用 `BASE_PATH=/ai-life-simulator/ pnpm build` 验证本地静态构建。
11. 检查构建产物和浏览器网络请求，确认线上不再访问 `/api/simulator/*`。

## 验收标准

- GitHub Pages 能在 `/ai-life-simulator/` 正常加载应用外壳。
- 从 GitHub Pages 开始模拟时，不再请求 `https://zhangxinyi08888-dot.github.io/api/simulator/*`。
- 配置有效 DeepSeek Key 后，线上版本可以生成追问、开始模拟、生成下一节点、进行时空穿越并生成最终洞察报告。
- 未配置 Key 时，线上版本展示环境配置错误提示，而不是通用网络失败弹窗。
- 本地开发不需要运行 Express。
- `pnpm lint` 通过。
- 现有工具测试和新增浏览器端 AI service 测试通过。
- Pages 产物只包含静态前端文件、`.nojekyll` 和 `404.html`。

## 风险与应对

- DeepSeek 的 CORS 策略未来可能变化。应对：把浏览器端 AI 客户端隔离成单独模块，未来需要恢复后端适配时不必重写 UI 状态。
- 浏览器包会暴露 prompt 和构建时 Key。应对：当前需求已接受该风险；通过简单配置降低实现和部署复杂度。
- Prompt 提取可能影响生成质量。应对：迁移时只移动逻辑，不改写语义；必要时对比迁移前后的 prompt 文本。
- 如果 `server.ts` 和浏览器 service 长期并存，逻辑可能漂移。应对：迁移完成后将 `server.ts` 标记为 legacy 可选模式，线上验证稳定后再考虑删除。

## 已确认实现选择

默认使用 `VITE_DEEPSEEK_API_KEY` 构建时注入方案。项目不实现页面配置入口，也不保存运行时 Key。本地开发通过 `.env.local` 配置，生产构建通过 `.env.production`、workflow env 或其他构建环境配置。当前阶段不需要围绕 Key 泄漏做额外防护。
