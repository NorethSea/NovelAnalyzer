# 小说分析器 (NovelAnalyzer)

基于 LLM 的本地小说分析、收藏与推荐工具。导入 `.txt` / `.epub` 文件后，会自动调用大模型从主题、情节、人物、文风、情感、氛围、文学价值、叙事技巧、象征等维度对每本小说做深度分析，并基于你的偏好生成推荐列表。

前端 React + Vite，后端 Express + sql.js（嵌入式 SQLite，零外部依赖）。

## ✨ 功能

- 📚 **文件夹扫描** — 自动发现 `小说库` / `收藏夹` 下的 `.txt` 和 `.epub` 文件
- 🤖 **LLM 深度分析** — 主题、情节、人物、文风、情感、氛围、文学价值、叙事技巧、象征 · 9 维度结构化输出
- 📦 **分块处理** — 大文件自动按 `chunk_size` 切分 + 比例重叠，分析后再合并
- ❤️ **喜欢 / 收藏** — 收藏夹导入自动标记为喜欢，可附带 1000 字内备注
- ⭐ **个性化推荐** — 基于喜欢的小说的偏好画像，跨库匹配候选
- 🔌 **多 LLM 切换** — OpenAI / Claude / Ollama 本地模型无缝切换
- ⚙️ **多方案管理** — 保存多套配置（不同 provider / prompt / 路径），一键切换
- 📊 **批量进度** — 实时 SSE 推送分块分析进度
- 🔁 **容错恢复** — 服务重启时自动恢复卡在 `analyzing` 状态的任务

## 🛠️ 技术栈

**前端** — React 18 · Vite 5 · React Router 6 · TailwindCSS 3

**后端** — Node.js 18+ · Express 4 · sql.js · TypeScript 5

**LLM SDK** — openai · @anthropic-ai/sdk · node-fetch (Ollama)

## 📁 项目结构

```
NovelAnalyzer/
├── src/
│   ├── api/                    # 前端 API 客户端
│   ├── components/             # 复用组件 (Button, Toast, ErrorBoundary…)
│   ├── hooks/                  # React Hooks (useListSelection, useBatchStatus…)
│   ├── pages/                  # 页面 (Home, Preferences, NovelDetail, Recommendations, Settings)
│   ├── utils/                  # 前端工具
│   └── server/
│       ├── index.ts            # 入口
│       ├── db/                 # sql.js 封装 + schema + 迁移
│       ├── routes/             # HTTP 路由
│       ├── services/           # 业务逻辑 (analyzer, recommender, scanner, parser)
│       ├── services/llm/       # LLM Provider 抽象 + 限流
│       ├── utils/              # 后端工具 (pathSecurity, rateLimit, validator, text)
│       └── types/              # 类型定义
├── data/novel_analyzer.db      # 运行时生成的 SQLite 数据库
├── dist/                       # 构建产物
├── start.bat / start.ps1       # Windows 一键启动
└── .env.example                # 环境变量模板
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm（或 npm / yarn）

### 安装

```bash
pnpm install
```

### 配置

复制 `.env.example` 为 `.env`，按需修改：

```env
PORT=3001
LLM_PROVIDER=openai

# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# Claude
CLAUDE_API_KEY=sk-ant-xxx
CLAUDE_MODEL=claude-sonnet-4-20250514

# Ollama (本地)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

> 也可先不填 .env，进 `设置` 页面用表单填写（保存在数据库里）。

### 启动

```bash
# 开发模式（前端 5173 + 后端 3001，热更新）
pnpm dev

# 或 Windows 一键启动
start.bat

# 生产构建 + 启动
pnpm build
pnpm start
```

打开 http://localhost:5173 即可使用。

## 🗄️ 数据库

使用 **sql.js**（WebAssembly 编译的 SQLite），数据库文件位于 `data/novel_analyzer.db`。

**为什么选 sql.js：**
- 零外部依赖（无需安装 SQLite）
- 跨平台一致（Windows / macOS / Linux / Docker）
- 整个库可被 Next.js / Edge runtime 复用

**数据表：**

| 表 | 说明 |
| --- | --- |
| `novels` | 小说元数据 + 状态 (`pending` / `analyzing` / `completed` / `error`) |
| `analyses` | 整体分析结果（9 维度 + 总结） |
| `chunk_analyses` | 分块分析（不存原文，只存 LLM 返回） |
| `preferences` | 用户喜欢的小说 + 备注 |
| `recommendations` | 推荐记录 |
| `llm_configs` | LLM 配置（支持多套方案 + is_active 标记当前） |
| `batch_jobs` | 批量任务（analyze / recommend）进度追踪 |

启动时会自动检查并迁移缺失列（`name` / `rpm_limit` / `timeout` / `max_tokens` / `type` 等）。

## 🔌 API 概览

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/novels` | 列出未收藏的小说 |
| GET | `/api/novels/all` | 列出所有小说 |
| GET | `/api/novels/:id` | 小说详情 + 分析 |
| POST | `/api/novels/:id/analyze` | 启动单本分析 |
| POST | `/api/novels/batch-analyze` | 启动批量分析 `{ids: number[]}` |
| POST | `/api/novels/:id/delete-analysis` | 删除单本分析 |
| POST | `/api/novels/batch-delete-analysis` | 批量删除分析 `{ids: number[]}` |
| POST | `/api/novels/import/folder-a\|b` | 扫描并导入文件夹 |
| GET | `/api/preferences` | 喜欢的小说 |
| POST | `/api/preferences/like` | 喜欢 `{novelId, note?}` |
| POST | `/api/preferences/unlike` | 取消喜欢 |
| GET | `/api/recommendations` | 推荐列表 |
| POST | `/api/recommendations/refresh` | 重新生成推荐 |
| GET | `/api/config` | 当前 LLM 配置 |
| PUT | `/api/config` | 更新配置 |
| POST | `/api/config/test` | 测试 LLM 连通性 |
| GET | `/api/config/presets` | 列出方案 |
| POST | `/api/config/presets` | 保存方案 `{name}` |
| PUT | `/api/config/presets/:id` | 重命名方案 |
| PUT | `/api/config/presets/:id/activate` | 切换方案 |
| DELETE | `/api/config/presets/:id` | 删除方案 |
| GET | `/api/events` | SSE 实时进度推送 |

## 🏗️ 架构要点

### LLM 抽象

`src/server/services/llm/` 下有 `openai.ts` / `claude.ts` / `ollama.ts` 三个 Provider，统一实现 `analyze(prompt) → string` 接口。

**限流**：`rateLimiter.ts` 是单例串行队列（用 Promise 链实现，零依赖），保证多 Provider 共享同一套 RPM 配额。切换 LLM 方案时复用同一限流器，避免时间窗口清零。

**重试**：`withRetry` 对 408 / 429 / 5xx 自动指数退避 3 次。

### 文件夹安全

`pathSecurity.ts` 校验所有用户提供的路径必须在数据库配置的 `folder_a` / `folder_b` 范围内，杜绝路径遍历（`../../etc/passwd` 之类）。

删除文件、扫描文件夹、导入文件都走同一套白名单。

### 并发控制

- **分析并发**：`analyzer.ts` 用 `runWithConcurrency` 限制为 4，避免 LLM 限流
- **同本互斥**：`activeAnalyses` 内存 Set + `tryStartAnalyzing` SQL 双重保护
- **批量互斥**：`batchRunning` 标志 + `batch_jobs` 状态机
- **API 限流**：`rateLimit.ts` 给所有 `/api/*` 加每 IP 令牌桶

### 实时进度

`/api/events` 是 SSE 端点，3 个并行连接上限 / 5 分钟 idle 超时，订阅 `progress` 和 `batch` 事件，前端用 `useBatchStatus` 200ms 节流刷新。

### 容错恢复

启动时 `recoverStuckState` 把所有 `analyzing` 状态的小说 + 进行中的 `batch_jobs` 重置为 `error` / `failed`，避免僵尸任务。

## 🔒 安全

- CORS 白名单由 `CORS_ORIGINS` 环境变量配置（默认 `localhost:5173,3000,127.0.0.1:5173`）
- 5xx 错误在 `production` 模式下不泄露内部消息
- 所有用户输入路径走白名单校验
- SQL 100% 参数化，无字符串拼接
- Rate limit: `/api/*` 每 IP 100 req / 15 min，SSE 每 IP 3 连接
- 优雅退出：`SIGTERM` / `SIGINT` 触发 → flush DB → close server

## 🧪 开发

```bash
# 类型检查
npx tsc -p tsconfig.server.json --noEmit   # 后端
npx tsc --noEmit                            # 前端

# 构建
pnpm build                                  # vite build && tsc

# 开发
pnpm dev                                    # concurrently 启动前后端
```

## 📜 License

仅供个人学习与研究使用。请遵守所使用 LLM 的服务条款，不要上传未经授权的受版权保护的内容。
