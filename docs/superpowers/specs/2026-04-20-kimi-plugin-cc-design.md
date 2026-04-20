# kimi-plugin-cc 设计文档

**日期**：2026-04-20
**作者**：bing + Claude Code（Opus 4.7）
**状态**：草稿，待 codex / gemini 3-way review
**仓库**：`/Users/bing/-Code-/kimi-plugin-cc/`（独立仓库）

---

## 1. 目标与范围

### 1.1 做什么

把 `gemini-plugin-cc` 的功能形态**完整手工移植**到 `kimi-plugin-cc`，底层 CLI 由 `gemini` 换成 `kimi`（Moonshot 官方 CLI）。Claude Code 里的用户能用 `/kimi:ask`、`/kimi:review` 等命令调用 Kimi 模型，用法和对应的 `/gemini:*` 命令一一对应。

这是一个模板项目——后续还要做 `minimax-plugin-cc` / `qwen-plugin-cc` / `doubao-plugin-cc` 等同类。本次手工实现过程中的所有差异点写入 `lessons.md`，供下一个 agent plugin 起步时直接复用。

### 1.2 交付物（v0.1）

- **8 个命令**：`setup` / `ask` / `review` / `rescue` / `cancel` / `status` / `result` / `adversarial-review`
- **3 个 skill**：`kimi-cli-runtime`（内部合约）/ `kimi-prompting`（prompt 诀窍）/ `kimi-result-handling`（输出呈现）
- **1 个 agent**：`kimi-agent.md`（subagent_type=kimi-agent）
- **2 个 hook**：`session-lifecycle-hook.mjs` + `stop-review-gate-hook.mjs`
- **1 个 JSON schema**：`schemas/review-output.schema.json`（独立一份，创建时字节对齐 gemini 版，后续可独立演进）
- **独立 git 仓库**，自带 `marketplace.json`
- **`lessons.md`**：本次迁移差异点与"给下个项目"的前置调研清单
- **`CHANGELOG.md`**：跨 AI 协作日志（reverse-chrono，flat 格式）

### 1.3 不做（v0.1 明确排除）

- 不用 `kimi acp` ACP server（要写 JSON-RPC client，引入复杂度，v0.2 再说）
- 不做 "ACP mode 自动 fallback" 之类的机灵功能
- 不支持 kimi `-C` 自动续跑（与 gemini 行为对跑：每次 `/kimi:ask` 新 session）
- 不写 Engram sidecar（kimi 没有与 `~/.gemini/projects.json` 对应的路径映射）
- 不做 MiniMax / 其它 provider 同仓支持
- **`/kimi:review` / `/kimi:adversarial-review` 的 JSON parse 失败时做 1 次带强化 prompt 的 retry**（v0.2 再扩为自适应多次重试）

### 1.4 成功标准

- 装好 `kimi` CLI 并 `kimi login` 过的机器上：
  `claude plugins add ./plugins/kimi` → `/kimi:setup` 通 → `/kimi:ask "hello"` 返回 → `/kimi:review` 对一个小 diff 产出符合 schema 的 JSON
- `lessons.md` 至少 5 条 gemini/kimi 差异点
- 命令级手工验证 checklist 的 T1-T5 通过（见 §6.1）

---

## 2. 仓库布局

### 2.1 根目录

```
kimi-plugin-cc/
├── .claude-plugin/
│   └── marketplace.json          # 注册 kimi 插件
├── plugins/
│   └── kimi/                     # 见 §2.2
├── doc/
│   └── PLAN.md                   # 由 writing-plans 生成
├── docs/superpowers/specs/
│   └── 2026-04-20-kimi-plugin-cc-design.md
├── README.md
├── CLAUDE.md                     # 工作目录级指令
├── CHANGELOG.md                  # 跨 AI 协作日志
├── lessons.md                    # 迁移经验
└── .gitignore
```

### 2.2 `plugins/kimi/` 内部（与 `plugins/gemini/` 一一对照）

```
plugins/kimi/
├── .claude-plugin/plugin.json
├── CHANGELOG.md
├── commands/
│   ├── setup.md
│   ├── ask.md
│   ├── review.md
│   ├── cancel.md
│   ├── status.md
│   ├── result.md
│   ├── rescue.md
│   └── adversarial-review.md
├── agents/
│   └── kimi-agent.md
├── skills/
│   ├── kimi-cli-runtime/SKILL.md
│   ├── kimi-prompting/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── kimi-prompt-recipes.md
│   │       ├── kimi-prompt-antipatterns.md
│   │       └── prompt-blocks.md
│   └── kimi-result-handling/SKILL.md
├── hooks/hooks.json
├── prompts/
│   ├── stop-review-gate.md
│   └── adversarial-review.md
├── schemas/review-output.schema.json
└── scripts/
    ├── kimi-companion.mjs
    ├── session-lifecycle-hook.mjs
    ├── stop-review-gate-hook.mjs
    └── lib/
        ├── args.mjs            # 纯复制
        ├── git.mjs             # 纯复制
        ├── process.mjs         # 纯复制
        ├── render.mjs          # 纯复制
        ├── state.mjs           # 改路径常量
        ├── prompts.mjs         # 手工改 prompt 文本
        ├── job-control.mjs     # 改 env 名
        └── kimi.mjs            # 完全从零写
```

### 2.3 手工改写 vs 几乎纯复制 的分界

| 类别 | 文件 |
|---|---|
| **完全从零写** | `kimi.mjs`、8 个 `commands/*.md`、2 个 prompt、3 个 skill 的内容 |
| **几乎纯复制**（< 10% 改动） | `args.mjs`、`git.mjs`、`process.mjs`、`render.mjs`、`state.mjs`、`job-control.mjs`、两个 hook 脚本、schema |
| **结构照抄** | 目录树、`plugin.json`、`marketplace.json` |

P2 原则下即使"几乎纯复制"的文件也要通读再写，不做 sed 批量替换。

### 2.4 命名替换规则

| gemini | kimi |
|---|---|
| `gemini` / `Gemini` | `kimi` / `Kimi` |
| `~/.gemini/` | `~/.kimi/` |
| `GEMINI_COMPANION_SESSION_ID` | `KIMI_COMPANION_SESSION_ID` |
| `gemini-companion.mjs` | `kimi-companion.mjs` |
| `gemini-agent` | `kimi-agent` |
| `/gemini:*` | `/kimi:*` |
| `~/.claude/plugins/gemini/` | `~/.claude/plugins/kimi/` |

---

## 3. CLI 集成（`kimi.mjs` 设计）

### 3.1 调用形态映射

| 场景 | gemini 原做法 | kimi 对应做法 | 备注 |
|---|---|---|---|
| 一次性提问 | `gemini -p "<p>" -o json -m <m>` | `kimi -p "<p>" --print --output-format stream-json -m <m>` | 统一走 stream-json，文本再拼接 |
| 流式提问 | `gemini -p "<p>" -o stream-json` | `kimi -p "<p>" --print --output-format stream-json` | **官方支持，非合成层**（codex review 纠正） |
| 续跑 session | `gemini -p "<p>" --resume <id>` | `kimi -p "<p>" --print -S <id>` | flag 不同，语义同 |
| 指定模型 | `-m <model>` | `-m <model>` | 一致 |
| 大 prompt | `-p ""` + stdin | 先 probe stdin；不行则临时文件 + `-p "$(cat …)"` | Phase 1 probe gate |
| 版本检查 | `gemini -v` | **`kimi -V`（大写！小写是 verbose）** | 易错点 |
| 认证探测 | ping 一次 | ping + 查 `~/.kimi/credentials/` | 见 §5.3 |

### 3.2 结构化输出策略（含 retry）

**两层结构化**：
1. **元层（session/stats/事件）**：由 `--output-format stream-json` 的 JSONL 提供（原生）
2. **业务层（review findings 等）**：由 prompt 约束 LLM 吐 JSON 字面量，嵌在 assistant message content 里

**业务层后处理流程**（`/kimi:review`、`/kimi:adversarial-review`）：
```
1. 收集所有 assistant message 的 content 拼成 final response
2. indexOf("{") 找 JSON 起点，JSON.parse
3. ajv 校验 schema（或手工 required-field 检查）
4. 成功 → 呈现
5. 失败 → retry 1 次（见下）
6. 再失败 → 原文展示 + 告警，不再重试
```

**retry 策略**（Phase 3 实现）：
- 触发：step 2/3 失败
- 新 prompt 拼装：原任务 + `"Your previous response could not be parsed as valid JSON. Return ONLY a raw JSON object matching this exact schema. No prose, no markdown fence, no comments. Start your response with { and end with }."`
- 可选：附上失败的原文让 LLM 自己看问题
- 最多 1 次。再失败走 step 6

**不做**（v0.2+）：自适应多次重试、schema-driven 逐字段补全、JSON 修复启发式。

### 3.3 流式输出策略（原生 stream-json）

kimi `--print --output-format stream-json` **原生支持** JSONL 事件流（codex review 纠正了前版错误）。`callKimiStreaming` 直接复刻 `gemini.mjs::callGeminiStreaming` 的行为：

```js
spawn('kimi', ['-p', '<prompt>', '--print', '--output-format', 'stream-json', '-m', model, ...],
      { stdio: 'pipe' })
  UTF-8 解码：StringDecoder 累积 chunk，按 '\n' 切行（**多字节中文字符边界保护**）
  每行 JSON.parse 成 event
  识别事件类型：init / message / result（具体键名以 probe 实测为准）
  透传给 onEvent
```

**关键实现点**：
- 必须用 `node:string_decoder.StringDecoder('utf8')` 缓冲 chunk，禁止直接 `chunk.toString()` 后按 `\n` 切——中文多字节字符在 stdio buffer 边界断开会乱码（参考 gemini.mjs L236-259 实现）
- 行缓冲处理断行事件（最后一条可能没 `\n` 结尾，close 时 flush decoder）
- 事件类型键名**以实测为准**，因为文档未列出完整 taxonomy（Phase 2 probe gate 的一项）

**stats 获取**：stream-json 的 result 事件大概率包含 stats。如果字段名与 gemini 不同（`total_tokens` vs `input_tokens + output_tokens` 等），`render.mjs` 的 stats 字段要做归一化映射。

**fallback**：如果 probe 发现 stream-json 不稳（如事件流中混入非 JSON 行），降级为 `--output-format text` + 全量 stdout buffer 一次性返回（失去流式 UX 但功能不崩）。

### 3.4 Session ID 获取（官方映射 + stream-json）

**实测发现**（codex review 纠正）：`~/.kimi/sessions/` 的结构是**两层**：
```
~/.kimi/sessions/<work_dir_md5>/<session_uuid>/
```
且 `~/.kimi/kimi.json` 维护 `work_dirs[]`，每个条目：
```json
{ "path": "<absolute-cwd>", "kaos": "local", "last_session_id": "<uuid>" }
```

**策略（按可靠度从高到低）**：

1. **Primary**：从 stream-json 的 `init`（或等价）事件直接读 session_id。**优先级最高**，因为是调用内生成、无并发歧义。
2. **Secondary**：调用后读 `~/.kimi/kimi.json`，按 cwd 精确匹配 `work_dirs[i].path` 取 `last_session_id`。仅当 primary 失败时 fallback。
3. **禁止用全局快照 diff**（前版设计）——并发调用或用户自己同时在跑 kimi 时会污染归因。
4. **Ultimate fallback**：返回 `sessionId: null`，后台任务标记 `sessionUnknown: true`，`/kimi:rescue --resume-last` 对此任务返回 "no resumable session"。

**Phase 1 probe 要验证的**：
- stream-json 流的哪个事件 key 携带 session_id（`session_id` / `id` / `event_id`…）
- `kimi.json.work_dirs` 的更新时机（`--print` 模式下是否更新？还是只有交互式更新？）
- cwd 传 `-w` 时 `work_dirs` 条目是按传入路径还是解析后绝对路径写入

没打通 Primary + Secondary 中的**至少一条**，不进 Phase 4。

### 3.5 默认模型读取

- gemini：`~/.gemini/settings.json` JSON 解析 `settings.model.name`
- kimi：`~/.kimi/config.toml` **顶层键 `default_model`**（官方 key 名已确认）

**不引 TOML 解析依赖**，但也**不用全文 regex**（会误吃注释/多行字符串/嵌套段）。实现一个**极简顶层键扫描器**：

```js
// kimi.mjs 内部工具函数
function readTomlTopLevelKey(text, key) {
  // 逐行扫，跳过注释行和表头（[section]），只匹配顶层 key = "value"
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) return null;  // 进入 section，顶层结束
    const m = line.match(/^(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}
```

读 `~/.kimi/config.toml` 后调 `readTomlTopLevelKey(text, "default_model")`。失败返回 `null`，上游不传 `-m`，让 kimi 内部兜底。

**不支持**：TOML 多行字符串、数组、嵌套表、字面量字符串（单引号）。v0.1 够用，若 kimi 后续把 `default_model` 搬到 `[agent]` 表下，再扩展。

### 3.6 认证检查

- `getKimiAvailability`：跑 `kimi -V`，非 0 退出码或二进制缺失 → 不可用
- `getKimiAuthStatus`：
  1. `~/.kimi/credentials/` 非空 → 可能已登录
  2. 发 `kimi -p "ping" --print --output-format stream-json --max-steps-per-turn N`，超时 30s
  3. 退出码 0 且事件流含 assistant message → 已登录

**`--max-steps-per-turn` 的 N 值由 Phase 1 probe 决定**：
- 先试 N=1，若 kimi 在 step 1 就能返回 assistant text（无需任何 tool use），保留 N=1
- 若 N=1 下 ping 总是被中断（kimi 模型初始化可能需 tool use 自检）→ 升 N=2，再测
- 最大容忍 N=3；超过 3 依然不稳 → 不限制 max-steps，改用 30s 超时硬截断
- 结论写入 `kimi-cli-runtime` skill 文档

这是 gemini 版没有的保护——kimi agent 化更强，裸 ping 可能触发自检步骤。

### 3.7 `kimi.mjs` 对外 API

与 `gemini.mjs` 同形：

```js
export function callKimi({ prompt, model, cwd, timeout, extraArgs, resumeSessionId }) { ... }
export function callKimiStreaming({ ..., onEvent }) { ... }
export function getKimiAvailability(cwd) { ... }
export function getKimiAuthStatus(cwd) { ... }
```

参数去掉 `approvalMode`（kimi 暂无对应概念）。上游 `commands/*.md` 和 `kimi-companion.mjs` 都不接受 `--approval-mode` flag；Claude 在 `/kimi:*` 命令里调用 Bash 时也不要传该参数。

### 3.8 不做的事

- 不用 `kimi acp`
- 不写 Engram sidecar（留空函数 stub）
- 不支持 `-C` 续跑
- 不做自适应重试

---

## 4. 命令、Agent、Skill

### 4.1 命令总表

| 命令 | 职责 | 与 gemini 版差异 |
|---|---|---|
| `/kimi:setup` | 检查可用性/登录态；切换 stop-review-gate | **安装路径不同**（Python pipx / uv，不是 npm） |
| `/kimi:ask` | 一次性提问 | prompt 模板微调 |
| `/kimi:review` | 对当前 diff 做 review | prompt 强化"仅 JSON"约束 |
| `/kimi:rescue` | subagent 委派多步任务 | subagent 名改 `kimi:kimi-agent` |
| `/kimi:status` | 查后台任务 | 一致 |
| `/kimi:result` | 拉后台任务结果 | 一致 |
| `/kimi:cancel` | 取消后台任务 | 一致 |
| `/kimi:adversarial-review` | 对抗性 review | prompt 重写 |

### 4.2 命令差异详解

**`/kimi:setup`**（最大差异）：
- 推荐安装方式（按优先级）：
  1. **官方 shell 安装脚本**（kimi FAQ 推荐，自带 Python 依赖管理）
  2. `uv tool install --python 3.13 kimi-cli`（官方文档显式 `--python 3.13`，避免命中错误 Python）
  3. `pipx install kimi-cli`（标注"未经官方验证，可能需手动处理 PATH"）
- 实现：
  1. `which kimi` 有 → 跳过安装提问
  2. 无 → 探测 shell / `uv` / `pipx` 可用性 → AskUserQuestion 三选项
  3. 安装完成后**必做 PATH 复探测**：用绝对路径（`~/.local/bin/kimi` 或用户指定安装前缀）再跑一次 `kimi -V`，如果绝对路径可跑但 `which kimi` 不到 → 告诉用户 "把 ~/.local/bin 加入 PATH，然后重开 shell"
  4. 未登录 → 提示 `! kimi login`（用户 shell 交互式登录）
- `--enable-review-gate` / `--disable-review-gate` 写 `~/.claude/plugins/kimi/state.json`

**`/kimi:ask`**：
- 同形：`node ${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs ask "$ARGUMENTS"`
- Claude 呈现规则：**原文转述 + 分歧点标注 + 不自动执行建议**

**`/kimi:review`**：
- Prompt 比 gemini 版更啰嗦强约束
- schema 文件在 `plugins/kimi/schemas/review-output.schema.json`（独立副本，创建时从 gemini 版拷贝 + 通读校对）
- 后处理 `indexOf("{")` 找 JSON 起点；parse 失败展示原文 + 告警

**`/kimi:rescue`**：
- 分发逻辑移植
- Agent tool `subagent_type: "kimi:kimi-agent"`
- `task-resume-candidate` 查 `~/.kimi/sessions/` 最近目录

**`/kimi:status` / `result` / `cancel`**：
- 走 `job-control.mjs`，与 LLM 无关
- 只改 job 目录名

**`/kimi:adversarial-review`**：
- `prompts/adversarial-review.md` 重写（kimi 在中文代码审阅上可能更直白，prompt 不需那么迂回）

### 4.3 Agent：`kimi-agent.md`

完全复刻 gemini-agent 的"薄转发器"契约，只改：
- `name: kimi-agent`
- `description`：`large-file analysis (Gemini's 1M window)` → `Chinese-language reasoning / long-context (Kimi 128K~1M depending on model)`
- `skills:` 改 `kimi-cli-runtime` + `kimi-prompting`
- Bash 命令 `gemini-companion.mjs` → `kimi-companion.mjs`
- Routing flags 表不变

**护栏保留**："Do NOT solve problems yourself / No independent work / Return stdout exactly"。

### 4.4 Skills

**`kimi-cli-runtime`**：
- 说明 `kimi-companion.mjs` 子命令约定
- 说明 `--json` 输出约定
- 去掉 gemini 特有 `--approval-mode` 段
- 加一段说明：**kimi 无结构化事件流，streaming 事件是合成的**

**`kimi-prompting`**：
- 保留通用原则（task framing / context blocks / output contract）
- references/ 下 3 个 md 重写：
  - `kimi-prompt-recipes.md`：中文任务、代码审阅、长文档摘要 sweet spot
  - `kimi-prompt-antipatterns.md`：kimi 易翻车的 prompt（v0.1 放框架，实测后补）
  - `prompt-blocks.md`：可复用块（`--thinking` 触发推理链）

**`kimi-result-handling`**：
- 比 gemini 版多一条：kimi 中文 prose 输出概率更高，Claude 呈现时保持原文，不自作主张翻译
- 其它规则照抄（分歧标注 / 不自动执行）

### 4.5 Hooks

- `hooks/hooks.json` 注册 `SessionEnd` + `Stop`
- `session-lifecycle-hook.mjs`：改 env 名 `GEMINI_COMPANION_SESSION_ID` → `KIMI_COMPANION_SESSION_ID`
- `stop-review-gate-hook.mjs`：改 state 路径；引用 `prompts/stop-review-gate.md`

### 4.6 Prompts

- `prompts/stop-review-gate.md`：重写
- `prompts/adversarial-review.md`：重写

---

## 5. State、认证、持久化

### 5.1 插件状态目录

`~/.claude/plugins/kimi/`：
- `state.json` — 开关（如 `reviewGate.enabled`）
- `jobs/<jobId>/` — 后台任务 stdout/stderr/pid/meta

### 5.2 kimi 自身数据目录（只读）

- `~/.kimi/config.toml` — 顶层键扫描读 `default_model`
- `~/.kimi/credentials/` — 登录凭据
- `~/.kimi/sessions/<work_dir_md5>/<session_uuid>/` — **两层结构**，session_id 是内层 uuid
- `~/.kimi/kimi.json` — **`work_dirs[].last_session_id` 用于 session 归因**（§3.4 Secondary）
- `~/.kimi/logs/` — 不碰

**原则**：插件绝不写 `~/.kimi/`。只读探测。

### 5.3 `/kimi:setup` 决策树

```
which kimi？
├── 无 → 探测 shell-installer / uv / pipx → AskUserQuestion 三选项
│         安装后 → 绝对路径复探测 → PATH 未生效则提示
└── 有
    kimi -V 成功？
    ├── 否 → 报二进制坏了
    └── 是
        ~/.kimi/credentials/ 非空？
        ├── 否 → 提示 "! kimi login"
        └── 是
            ping-call 成功？（--output-format stream-json --max-steps-per-turn N，N 由 probe 定）
            ├── 否 → 报认证问题
            └── 是 → { installed, authenticated, model, version }
```

### 5.4 模型选择优先级

1. 命令行 `--model <m>` / `-m <m>`
2. `~/.kimi/config.toml` regex 读 default
3. 都没 → 不传 `-m`，kimi 内部兜底

### 5.5 环境变量

| env | 作用 |
|---|---|
| `KIMI_COMPANION_SESSION_ID` | Claude Code session id |
| `CLAUDE_PLUGIN_ROOT` | Claude 注入 |
| `KIMI_CLI_BIN`（可选）| 覆盖 kimi 二进制路径（测试用） |

### 5.6 Engram sidecar

v0.1 不做，`kimi.mjs` 留空 stub：

```js
function writeEngramSidecar(sessionId, cwd) {
  // TODO v0.2: wire up once engram supports kimi session paths
}
```

---

## 6. 测试、lessons.md、rollout

### 6.1 测试策略（命令级手工验证 checklist）

| 阶段 | 动作 | 通过标准 |
|---|---|---|
| T1 probe | `setup --json` | `{installed, authenticated, model, version}` 齐全 |
| T2 headless | `ask --json "hello"` | 非零 response，JSON parse 成功 |
| T3 streaming | `ask --stream "讲个笑话"` | stdout 增量输出（非一次吐完） |
| T4 session-id | T2 后比对 sessions 目录 | 能定位新增 session dir |
| T5 review | 对 3-5 行样例 diff | schema 齐全（verdict/findings/next_steps） |
| T6 background | `rescue --background` → `status` → `result` | 状态流转正确 |
| T7 resume | `rescue --resume-last` | 续上次 session |
| T8 install fresh | 干净环境跑 setup | 走到引导安装分支 |
| T9 adversarial | 对样例 diff 跑 adversarial-review | 红蓝两视角均产出 findings |

T1-T5 是 v0.1 下限；T6-T8 是 v0.1 上限。**T1-T5 不过不 tag v0.1。**

### 6.2 `lessons.md` 骨架

**两层维度**：CLI 集成层（机械） + LLM 行为层（灵魂）。缺任何一层都会在下一个 plugin 翻车。

```markdown
# Lessons: gemini-plugin-cc → kimi-plugin-cc 手工迁移

## A. 命名替换规则表
（见 spec §2.4）

## B. 必须重写的 9 项（不要抄）
1. scripts/lib/<llm>.mjs
2. commands/setup.md
3. commands/review.md
4. prompts/stop-review-gate.md
5. prompts/adversarial-review.md
6. skills/<llm>-prompting/ 整个目录
7. skills/<llm>-cli-runtime/SKILL.md
8. skills/<llm>-result-handling/SKILL.md
9. agents/<llm>-agent.md

## C. 可以几乎纯复制的 8 项

## D. 本次踩的坑（边做边加）
### kimi 坑 1: -V 是大写，-v 是 verbose
### kimi 坑 2: stream-json 是官方支持的（我第一版 spec 漏查 kimi-command.md 文档）
### kimi 坑 3: session 归因走 kimi.json.work_dirs，不做 snapshot diff
（...滚更）

## E. CLI 集成层前置调研清单（机械）
- [ ] 目标 CLI 支持 headless / -p？
- [ ] 有 JSON 结构化输出？选项名？事件 taxonomy？
- [ ] session_id 怎么拿？（从事件流 / 配置文件 / 目录探测）
- [ ] 安装方式？（npm / pip / pipx / uv / shell installer / brew）
- [ ] 认证方式？（OAuth / API key / 本地凭据文件）
- [ ] 配置文件格式？（JSON / TOML / YAML / 自定义）
- [ ] 目录布局？（~/.<tool>/ 下的子目录结构）
- [ ] PATH 安装后是否立即可见？
- [ ] 大 prompt 传递：stdin 支持？

## F. LLM 行为层前置调研清单（灵魂，gemini review 补充）
- [ ] **JSON 依从度**：裸让模型返回 JSON 时是否加 markdown fence？是否加前缀"好的，这是 JSON："？是否严格遵守 schema？
- [ ] **Token 窗口与长上下文衰减**：声明的 context window vs 实际高质量利用率（常见 >80% 时质量断崖）
- [ ] **Rate limit 阈值**：RPM / TPM / 并发限制
- [ ] **中英文处理差异**：提示语种对输出质量的影响；是否"中文 prompt 出英文结果" 的逆向偏差
- [ ] **工具调用倾向**：裸 ping 会不会触发自检 tool use（影响 --max-steps-per-turn 选值）
- [ ] **推理链触发条件**：`--thinking` / reasoning token 的开销和质量增益
- [ ] **错误态表达**：模型"不会/无法/拒绝"时的典型返回形式（影响 review 解析容错）

## G. 决策分歧记录（跨 AI review 留痕）
每次 spec review 后记录：谁提了什么、接受/拒绝/部分接受、为什么。
```

### 6.3 `CHANGELOG.md` 契约

仓库根维护，reverse-chrono flat。每次 AI 写代码前读、写完追加。v0.1 第一条由本 spec 落盘写入。

**条目格式**（gemini review 补充：单 Markdown 做 3 家 AI 协作需要 hand-off 信号）：
```markdown
## YYYY-MM-DD HH:MM [author]
- **status**: draft | in-progress | done | handed-off-to-<X> | blocked
- **scope**: <files/areas touched>
- **summary**: <what changed and why>
- **next**: <what the next author should pick up>（可选）
```

**协作规则**：
1. 写前先读 CHANGELOG 最后 5 条，若最新条目 `status: in-progress` 且 author 不是自己 → 不动手，问用户
2. `handed-off-to-<X>` 是显式交棒信号，只有被指定的 X 能接着写
3. `blocked` 状态要附 `next` 说清楚卡在哪
4. v0.1 不做锁 / 回滚共识（gemini review 提议，但属于 overengineering，推迟到实际发生冲突时再说）

### 6.4 Rollout 步骤

1. **Spec 落盘** ← 已完成
2. **3-way review**：并行 codex + gemini 审 spec；整合反馈 ← **已完成（本轮）**
3. **writing-plans** 生成 `doc/PLAN.md`
4. **executing-plans** 分 Phase 实施（**skill 前置**，gemini review 修正了前版倒置）：
   - **Phase 0 实测 probe（写 spec 前置 gate 的补偿）**：
     - stream-json 事件 taxonomy 实测 → 确定 session_id / stats 事件键名
     - `kimi.json.work_dirs` 在 `--print` 模式下的更新行为
     - stdin pipe 大 prompt 支持
     - `--max-steps-per-turn` N 值选取
     - 结果写入 `kimi-cli-runtime` skill（先出初稿）
   - **Phase 1 骨架 + skill 初稿**：目录 + `kimi.mjs` + `/kimi:setup` + **`kimi-cli-runtime` skill**（从 Phase 0 probe 结果落地）+ **`kimi-prompting` skill 骨架** → 过 T1、T8
   - **Phase 2 核心（有 skill 护栏）**：`/kimi:ask` + streaming 原生 stream-json + **`kimi-result-handling` skill 初稿** → 过 T2、T3、T4
   - **Phase 3 review + retry**：`/kimi:review` + schema + JSON parse retry → 过 T5
   - **Phase 4 后台任务**：rescue/status/result/cancel + agent → 过 T6、T7（依赖 Phase 1 的 session_id 通路已打通）
   - **Phase 5 收尾**：adversarial-review + 3 个 skill 打磨定版（基于前面 phase 的实战） + lessons.md 补完 → 过 T9
5. 每个 Phase 结束提交 CHANGELOG.md（带 `status` 字段）+ 跑对应 T
6. 全部 T 通过 → 打 v0.1.0 tag

**硬门**：Phase 0 若 stream-json 或 session_id 通路**都**打不通，停下告警用户——不降级硬上 Phase 1。这是 gemini review "full-parity scope 风险" 的兜底。

### 6.5 非目标（v0.2+）

- ACP 协议集成
- Engram sidecar
- 自适应多次重试 / schema-driven 字段补全 / JSON 修复启发式（v0.1 已含"1 次 retry"）
- `-C` 续跑语义
- MiniMax / 其它 provider 共仓
- CHANGELOG 并发锁 / 回滚共识

---

## 附录 A：Phase 0 probe 项（精简后）

3-way review 后，以下 5 项被 codex/gemini 从"未知"里剔除或明确：
- ~~kimi `--print` 是否 stdout 即时冲洗~~ → 用 stream-json，逐事件发射，不关心 flush
- ~~session_id 获取~~ → 见 §3.4 Primary+Secondary 明确方案
- ~~config.toml 默认模型键名~~ → 官方已定 `default_model`
- ~~`kimi export --latest` 形态~~ → 不用此路径，走 stream-json 事件
- ~~stream-json 是否支持~~ → 官方支持，无需 probe

**剩余真·未知，Phase 0 必须 probe**：
1. **stream-json 事件 taxonomy**：事件 key 名（type / event / kind）、session_id 携带字段、stats 结构
2. **session 归因校验**：`~/.kimi/kimi.json.work_dirs` 在 `--print` 模式下是否更新；传 `-w` 时 path 归一化规则
3. **大 prompt stdin**：`kimi -p "" --print` 从 stdin 读是否支持（gemini 大 prompt 走 stdin trick），或需临时文件
4. **`--max-steps-per-turn` 探测**：ping-call 下 N=1/2/3 稳定性
5. **stream-json 失败模式**：中途进程被杀、认证失败、模型超时时的事件尾态

每项在 Phase 0 写独立 probe 脚本，结果写入 `kimi-cli-runtime` skill。**Phase 0 不过不进 Phase 1**。

---

## 附录 B：3-way Review 留痕（2026-04-20）

本 spec 在 v0.1 草稿后由 Claude Code（Opus 4.7）并行发起 codex:rescue 和 gemini:gemini-agent 审读，主要采纳项：

**从 codex（技术风险视角）**：
- §3.3 原"kimi 无 stream-json 需合成"为事实错误 → 改用原生 stream-json + UTF-8 StringDecoder
- §3.4 session 归因从"全局快照 diff"改为"stream-json 事件 + kimi.json.work_dirs 二路径"
- §3.5 regex 读 config.toml 改为极简顶层键扫描
- §4.2 setup 加 PATH 复探测和 uv 官方 --python 3.13
- 附录 A 大幅精简（5 个未知点去 3 个伪问题）

**从 gemini（战略/范围视角）**：
- §6.4 Phase 5 skill 倒置 → skill 初稿前置到 Phase 1/2，Phase 5 只做打磨
- §1.3 "不做 auto-retry" 与 §4.4 kimi 中文 prose 体质矛盾 → 捞回 1 次 retry 作 v0.1 范围
- §6.2 lessons.md 加 LLM 行为层维度（JSON 依从度 / token 衰减 / rate limit / 工具调用倾向 / 推理链）
- §6.3 CHANGELOG 加 status 字段作 hand-off 信号
- §6.4 加 Phase 0 probe 硬门

**拒绝采纳**：
- gemini 建议缩到 MVP 3 命令——用户已决定 full-parity；codex 的 `kimi.json.work_dirs` 发现已大幅降低 session 风险；保持 full-parity
- gemini 建议 CHANGELOG 加锁 / 回滚共识——v0.1 overengineering，推迟

---

## 附录 B：参考

- `gemini-plugin-cc` 仓库：`/Users/bing/-Code-/gemini-plugin-cc/`
- kimi CLI 文档：https://moonshotai.github.io/kimi-cli/
- kimi CLI LLM 友好版：https://moonshotai.github.io/kimi-cli/llms.txt
- kimi CLI 源码：https://github.com/MoonshotAI/kimi-cli
