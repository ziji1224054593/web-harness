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

### 有需求时如何和 Lead 对话

当你拿到一个新需求,建议先让 `lead_orchestrator` 作为主入口。它会继承 `_shared-protocol.md` 的通用约束,再按 `lead_orchestrator.md` 的职责完成需求收敛、任务拆解、Gate 判断和角色分发。对话重点不是直接说"去开发",而是先把需求、范围、资料和约束交给 Lead,让它判断是否能进入下一阶段。

推荐第一次对话这样说:

```text
你现在使用 `ai/ai-prompts/_shared-protocol.md` + `ai/ai-prompts/lead_orchestrator.md` 的身份工作。

请作为 `lead_orchestrator` 处理一个新需求:
- RUN_ID: RUN-20260626-LOGIN
- 需求目标: 实现/修改/修复什么
- 目标模块: 相关页面、菜单、路由或代码目录
- 需求材料: PRD 链接/原型链接/截图/API 文档/用户补充说明
- 已知边界: 哪些要做,哪些不要做
- 验收口径: 用户最终怎么确认完成

请先不要直接改业务代码。先完成:
1. 判断需求属于哪个 tier(light/standard/full)
2. 读取当前仓库相关摘要、契约和源码入口
3. 梳理功能点清单和真实链路八问
4. 识别需要 Product / Architecture / UX / Frontend / QA / Review 哪些身份参与
5. 列出待人工确认项、阻断项和下一步命令
6. 产出本轮 Lead 收敛结论草稿,等待我确认后再分发 role-packets
```

如果需求里有原型、截图或链接,要明确告诉 Lead:

```text
这个需求包含原型/截图。请先定位目标模块对应的原型界面和流程节点,保存截图证据并形成截图清单;在截图覆盖目标模块、并完成 PRD/API/现有实现对标前,不要进入 Frontend 分发。
```

如果需求涉及 API、字段、权限、枚举、状态流转、表单提交或详情回显,要明确告诉 Lead:

```text
这个需求涉及后端数据。请先完成契约预检:列出 endpoint、request/response schema、字段映射、枚举/字典来源、权限规则和 contract gap/conflict。契约不清时请阻断并列出需要人工确认的问题,不要让 Frontend 猜字段实现。
```

当 Lead 输出收敛草稿后,你需要用人工确认的方式继续对话:

```text
我确认本轮范围、真实链路、交互决策、接口契约和任务拆解。请继续定版 run-summary,生成各身份 role-packets,并告诉我下一步应该执行哪些 Harness 命令。
```

如果不确认,直接指出要改哪里:

```text
暂不确认。请缩小范围:本轮只做列表查询和详情查看,新增/编辑放到下一个 RUN。请更新 Gate 结论、任务拆解和待确认项。
```

Lead 的关键边界:

- 不直接改业务实现源码;它负责收敛、拆解、分发、登记 artifact 和控制 Gate。
- 不凭聊天记录或最新文件名判断当前有效输入;必须以 `ai/runtime/runs/<RUN_ID>.json` 和 `current-artifacts.md` 为准。
- 未完成人工确认前,不应定版 `run-summary`、不应分发正式 `role-packets`、不应进入 Frontend。
- 遇到交互不清回退 UX,契约不清回退 Architecture / Integration / Backend,业务边界不清回退 Product。

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

## 身份使用说明

Harness 里的"身份"就是角色 id,写在任务的 `ownerRole`、群消息的 `--from` / `--to`、人工操作的 `--by` 以及每角色机器人环境变量后缀里。内置身份如下:

- `product` — 产品需求助手,负责需求澄清、范围界定、验收标准和待确认项整理。
- `architecture` — 前端架构助手,负责模块扫描、技术边界、目录影响和契约约束。
- `lead_orchestrator` — 多角色协作调度官,负责方案收敛、上下文分发、Gate 控制和主编排推进。
- `ux` — 交互设计助手,可选支持身份,负责页面流程、状态矩阵和关键交互说明。
- `frontend` — 前端开发助手,负责页面、组件、路由、API、状态管理和国际化落地。
- `qa` — 测试验证助手,负责验证执行、回归检查和质量结论。
- `review` — 交付审查助手,负责交付前只读审查、风险识别和发布建议。
- `integration` / `backend` / `devops` — 可选支持身份,分别用于联调契约、后端接口口径和工程发布支持。
- `system` — 系统播报身份,用于运行时事件、默认通知和无人值守消息。

### 1. 在任务里指定负责人

任务定义使用 `ownerRole` 指定由哪个身份执行。`task.type` 必须在该身份的 `allowedTaskTypes` 内,否则运行时会结构化阻断,不会误判为成功。

```yaml
id: FE-001
title: 实现登录页
type: implementation
ownerRole: frontend
gate: G4
dependsOn:
  - SOL-001
status: todo
```

常用对应关系:`requirement → product`,`scan → architecture`,`solution → lead_orchestrator` 或 `ux`,`implementation → frontend`,`validation → qa`,`review → review`。

### 2. 以身份发群消息

用 `ai:post` 记录交接、完成、打回或备注。`--from` 是发言身份,`--to` 是接收身份或 `all`;这只写入沟通事件和 IM 播报,不直接推进任务状态。

```bash
pnpm ai:post -- --run RUN-SAMPLE-001 --from frontend --to qa --kind done --task FE-001 --text "登录页已完成,请开始验证"
pnpm ai:post -- --run RUN-SAMPLE-001 --from qa --to frontend --kind reject --task QA-001 --text "移动端登录失败,请返工"
```

### 3. 以身份执行人工操作

`--by` 表示这次人工操作由哪个身份或操作者发起。省略时会使用当前 RUN 的主编排者,再退回到 `manual`。

```bash
pnpm ai:approve -- --run RUN-SAMPLE-001 --task SOL-001 --by lead_orchestrator --reason "方案和范围已确认"
pnpm ai:reject -- --run RUN-SAMPLE-001 --task QA-001 --by qa --reason "验收失败,需要返工"
pnpm ai:artifact -- --run RUN-SAMPLE-001 --key current_frontend_handoff --path ai/context/runs/RUN-SAMPLE-001/frontend-handoff.md --by frontend --note "前端交接 QA"
```

### 4. 移交主编排身份

RUN 级写权限由主编排者持有。需要把当前 RUN 的主编排权交给其他操作者时使用 `ai:handoff`;只有当前主编排者可以正常移交。人工确认后的强制接管可使用 `--takeover true`。

```bash
pnpm ai:handoff -- --run RUN-SAMPLE-001 --by lead_orchestrator --to release-owner --reason "进入发布前人工确认"
pnpm ai:handoff -- --run RUN-SAMPLE-001 --by release-owner --takeover true --reason "人工确认接管"
```

### 5. 为不同身份配置机器人

IM 默认使用 `AI_ORCH_IM_WEBHOOK`;如需让不同身份显示为不同机器人,在 `.env.local` 中配置每角色 webhook。后缀是身份 id 的大写形式,例如:

```bash
AI_ORCH_IM_WEBHOOK_PRODUCT=
AI_ORCH_IM_WEBHOOK_LEAD_ORCHESTRATOR=
AI_ORCH_IM_WEBHOOK_ARCHITECTURE=
AI_ORCH_IM_WEBHOOK_UX=
AI_ORCH_IM_WEBHOOK_FRONTEND=
AI_ORCH_IM_WEBHOOK_QA=
AI_ORCH_IM_WEBHOOK_REVIEW=
AI_ORCH_IM_WEBHOOK_SYSTEM=
```

支持身份、任务类型和读取策略的完整定义见 `ai/runtime/definitions/roles.yaml`;流水线阶段和默认负责人见 `ai/runtime/definitions/pipelines.yaml`。


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
