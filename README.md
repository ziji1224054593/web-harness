# Harness

> 一个 AI 交付编排运行时:多 Agent 按阶段接力、人工门禁逐道放行、验收不过自动**打回返工**(带熔断),全程围绕**单一事实源**推进。

Harness 把一个需求拆给多个角色身份(产品 → 架构 → 交互 → 前端 → 测试 → 审查),按 6 道门禁接力推进。它本身是**确定性编排状态机**,不是"会调工具的 Agent":能确定性验证的就跑真实命令,需要创作的才委托给具备工具能力的编码 Agent。

**官网 / 可交互演示**:[`docs/index.html`](docs/index.html) —— 介绍能力、工作方式、流程、特点亮点与使用优势,内含可点击的现场演示控制台。用浏览器直接打开即可,离线、纯前端、零依赖。

> 发布到 GitHub Pages:仓库 Settings → Pages → Source 选 `Deploy from a branch`,Branch 选 `main` + `/docs`。`docs/index.html` 是 [`tools/ai-orchestrator/dashboard/demo.html`](tools/ai-orchestrator/dashboard/demo.html) 的发布副本。

---

## 核心特性

- **阶段门禁(G1–G6)** — 六个角色按阶段接力,每道门禁人工确认才放行,关键交接不被悄悄跳过。
- **打回—返工熔断** — 验收不过带问题清单打回上一棒,`reworkRounds` 计数;触顶 `maxRounds`(默认 3)自动熔断,转人工裁决。
- **拉取式执行** — 任务进就绪队列由 worker 轮询领取并上 `lease` 租约;依赖未完成不进队列。
- **单写者写保护** — 同一 RUN 单写者:CAS 版本号 + 目录锁,外来写以 revision mismatch 被拒。
- **多 RUN 并行** — 每条 RUN 独立运行态 / 锁 / owner,跨 RUN 全并行。
- **适配器路由** — 校验任务跑真实命令(凭退出码判定),其余创作类任务委托工具型编码 Agent。
- **分档裁剪** — `light` / `standard` / `full` 按变更规模裁剪门禁链。
- **单一事实源** — 事实源是 `ai/runtime/runs/<RUN>.json`;台账、门禁、聊天通道对话都是它的投影。

---

## 目录结构

```text
harness/
├── tools/ai-orchestrator/        # 编排运行时(可执行)
│   ├── commands/                 # CLI 入口(init / plan / run / sync / ...)
│   ├── runtime/                  # planner / scheduler / dispatcher / 适配器 / store
│   ├── core/  types/             # 投影与运行态的共享契约
│   ├── dashboard/                # demo.html(讲解+演示)/ flow.html
│   └── tests/                    # 运行时契约与项目契约测试
└── ai/
    ├── ai-prompts/               # 各角色 prompt + 共享协议
    ├── templates/                # 任务 / 交接 / 总结模板
    └── runtime/
        ├── definitions/          # roles / pipelines / read-policies / project.yaml
        ├── schemas/              # 运行态 / 任务 / 事件 / 报告等 JSON Schema
        └── tasks/                # 任务定义(事实源,手写;ai:init 可生成示例)
```

> 路径说明:运行时把仓库根目录解析为 `runtime/` 往上三层,所以请保持 `tools/ai-orchestrator/` + `ai/` 这个布局。

---

## 快速开始

需要 Node.js 20+ 与 pnpm。

```bash
# 1) 安装依赖
pnpm install

# 2) 初始化工作区:创建运行时骨架目录 + 一条示例任务链(G1→G6)
pnpm ai:init

# 3) 按你的项目改契约:workspaceRoot + 校验命令
#    编辑 ai/runtime/definitions/project.yaml
pnpm ai:validate-project

# 4) 规划一条 RUN(只建运行态 + 投影,不执行任务)
pnpm ai:plan -- --run RUN-SAMPLE-001

# 5) 打开控制台看板(生成到 dashboard/ 并在浏览器打开)
pnpm ai:overview
```

> 执行 AI 创作类任务(`pnpm ai:run`)需要为 Agent 适配器配置密钥,见下方「配置」。
> 只跑 `init / plan / sync / validate-project / overview` 不需要任何外部密钥。

---

## RUN 生命周期命令

| 命令 | 作用 |
| --- | --- |
| `ai:init` | 初始化运行时骨架目录,写入示例任务链(`--bare` 只建目录,`--force` 重写示例) |
| `ai:plan` | 载入任务、建/刷新运行态,投影台账 + 门禁 + 报告 |
| `ai:run` | 领取就绪任务、执行、提交证据(lock + CAS)、刷新投影 |
| `ai:sync` | 仅重新投影(不执行),未变更产物自动跳过 |
| `ai:post` | 发布一条交接消息(done / pass / reject 等)到聊天通道与 channel.md |
| `ai:retry` | 把可重试的 blocked / failed 任务移回就绪(计一轮返工) |
| `ai:handoff` | 把某 RUN 的写权限移交另一身份(仅当前 owner 可移交) |
| `ai:artifact` | 更新当前 artifact 指针 / 标记被取代项 |
| `ai:approve` / `ai:reject` | 门禁人工确认 / 打回 |
| `ai:pause` / `ai:resume` | 暂停 / 恢复一条 RUN |
| `ai:recover` | 回收过期租约,重新解锁就绪任务 |
| `ai:board` / `ai:overview` | 渲染单 RUN 看板 / 全部 RUN 总览 |
| `ai:report` | 打印机器可读运行摘要 |

---

## 执行模型(适配器路由)

调度器按 `task.type` 把任务分流到不同执行器:

- **校验任务(`validation`)** → 本地校验适配器直接 `exec` 你在 `project.yaml` 里声明的真实命令,凭**退出码**判定 `done` / `failed` / `blocked`,每条命令产一条结构化证据 —— 不让 LLM "口头说通过"。
- **创作类任务**(`requirement` / `scan` / `solution` / `implementation` / `review`)→ 委托给具备**读写文件、跑命令**能力的编码 Agent(参考适配器用 Cursor SDK)在工作区执行;Harness 只负责注入角色 prompt、任务边界与输出契约。
- **工具级门禁** — 每个角色声明 `allowedTaskTypes`,领到不被允许的任务类型直接 `blocked`;缺密钥 / SDK / 角色未注册都返回结构化阻断,不会被当成成功。

> 想接其他执行后端(自托管模型、MCP 工具、函数调用循环等),替换 `runtime/dispatcher.mjs` + `runtime/cursor-agent.mjs` 这一层即可,其余编排逻辑不变。

---

## 配置

### 项目契约 `ai/runtime/definitions/project.yaml`

描述被编排的工作区:`workspaceRoot` 指向你的项目,`validation.checks` 是校验(QA)阶段要跑的真实命令。初始模板里的命令是占位 no-op,请替换成你项目的真实命令(如 `pnpm lint` / `pnpm typecheck`)。

### 环境变量

复制 `tools/ai-orchestrator/.env.example` 为 `tools/ai-orchestrator/.env.local`(已被 gitignore),按需填写:

- `CURSOR_API_KEY` / `CURSOR_AGENT_MODEL` — Agent 适配器(创作类任务)。
- `AI_ORCH_IM_*` — 聊天通道播报(`console` 仅打印 / `slack` / 通用 `webhook`)。

加载方式:`node --env-file=tools/ai-orchestrator/.env.local ...` 或在 shell / CI 里 export。

---

## 角色与流水线

- 角色定义:`ai/runtime/definitions/roles.yaml`(每个角色的 `allowedTaskTypes`、能力、读取策略、对应 prompt)。
- 流水线:`ai/runtime/definitions/pipelines.yaml`(默认 `page-delivery`:6 阶段 + 门禁绑定 + 依赖顺序 + 人工确认点)。
- 角色 prompt:`ai/ai-prompts/`(共享协议 `_shared-protocol.md` + 各角色)。

按你的团队与技术栈裁剪这些定义即可。

---

## 测试

```bash
pnpm test          # 运行运行时契约与项目契约测试(node --test,无需外部依赖)
```

---

## License

[MIT](LICENSE) © 2026 Harness contributors
