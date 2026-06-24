# 共享协作协议（Shared Protocol）

> **本文件是所有角色 prompt 的公共底座。** 每个角色文件开头都声明"继承本协议"，因此本文件中的规则对
> Lead / Product / Architecture / UX / Frontend / QA / Review / Integration / Backend / DevOps **默认全部生效**，
> 各角色文件只描述与本协议的**差异和角色专属内容**，不再逐条复述这些通用规则。
>
> 当某角色与本协议冲突时，以更严格的一方为准；如确需放宽，必须在该角色文件中显式写明例外。

---

## 1. 运行态单一事实源

- `ai/runtime/runs/<RUN_ID>.json` 是当前 RUN 的**唯一运行态源**；`task-backlog.md`、`gate-status.md`、`current-artifacts.md` 都是它的**投影**，不得手改投影来"绕过"运行态。
- 优先修改运行态 JSON，再重新投影派生产物。
- 机器可读编排入口为 `tools/ai-orchestrator/`（`ai:plan / ai:run / ai:sync / ai:approve / ai:reject / ai:handoff / ai:artifact` 等）。**凡该 CLI 能强制的不变量（阶段推进、Gate、artifact 指针、写保护、返工熔断），以工具判定为准；prompt 文字只是其角色视图，不得绕过工具结论自行推进。**

## 2. 当前有效输入的认定（强制）

- 任何角色开工前，**必须先读取** `ai/context/runs/<RUN_ID>/current-artifacts.md`；若不存在或未指向本阶段必需输入，必须**阻断并回退 Lead 补齐**，不得自行猜测。
- **禁止**通过"最新修改时间""文件名看起来最新""聊天上下文"推断当前有效输入；当前有效输入只能来自 `current-artifacts.md` 或 `ai/runtime/runs/<RUN_ID>.json` 中明确登记的 artifact 指针。
- 默认**忽略**：未确认的 `*-draft.md`、被 `superseded` 的旧报告、其他 `RUN_ID`、其他业务域的报告——除非 `current-artifacts.md` 的 `depends_on` 显式引用。

## 3. draft / confirmed 双态与交接

- 所有阶段产物先以 `*-draft.md` 落地；只有经过人工确认、并由主 Lead 更新 artifact 指针后，才能作为下一阶段的当前有效输入。
- 每份阶段报告必须写明：`RUN_ID`、`supersedes`（替代了哪些 draft / 旧报告）、`depends_on`（依赖的上游报告）、本轮读取的当前有效 artifact、忽略的旧 / draft / superseded 范围。
- 角色之间通过标准化交接物 + `current-artifacts` 指针协作，**不依赖**"让下游全目录扫描找最新"。

## 4. 单写者与并发治理

- 同一 `RUN_ID` 只能有一个主编排者拥有运行态写权限；其他同 RUN 会话只能做分析、建议或草稿，不得并行改写阶段状态、Gate 结论和当前有效 artifact 指针。
- 多需求并行时为每个需求建立独立 `RUN_ID`；不同 RUN 若最终命中同一代码区域，必须在进入 Frontend 前显式记录冲突风险与协调方案。
- 同一 `RUN_ID` 默认只有一个 Frontend Agent 改源码；其他 Frontend 窗口只能产出方案 / 审查 / 草稿，除非 Lead 明确拆分 RUN 或隔离工作树。

## 5. 契约纪律（涉及后端数据时强制）

- **唯一权威契约源**：项目的 API / 契约源（机器可读登记见 `ai/runtime/definitions/project.yaml > context.contractSource`）。其他位置的契约副本一律视为历史副本 / 指针，禁止作为事实源。
- 凡需求涉及 API、字段展示、详情回显、表单提交、状态/枚举、权限判断、树结构、下拉选项、审计日志、导入导出或任何后端数据来源：开始下一步前必须完成**契约预检**，建立"业务字段 ↔ 契约源字段 ↔ 实现侧类型/表单字段 ↔ 展示/提交处理"映射；不得凭经验猜字段名、状态码、枚举值或请求体。
- 不得用相似字段名互相替代：含义相近但语义不同的字段（如 `updateBy` / `updatedBy` / `updateByName` 之类）必须逐项核对语义，不得想当然等同。
- 契约缺字段、字段冲突、语义不清或实现与契约不一致时，必须记为 **contract gap / contract conflict** 并阻断 / 请求确认，禁止静默实现或静默通过。
- 共享枚举/字典优先：状态/类型/是否/显示隐藏等枚举型选项必须优先走项目的共享枚举/字典源（如有）及其现有访问方式，不得在实现侧写死枚举。具体的字典类型编码须来自 packet / 契约源 / Integration 结论，不得自行命名。

## 6. 读取策略（summary-first, source-on-demand）

1. 先读仓库级规则与摘要：`AGENTS.md`、`ai/docs/summary/`。
2. 再读本轮 `run-summary` 与本角色 `role-packet`。
3. 再读 `current-artifacts.md` 指向的当前有效交接 / 证据入口。
4. 最后才按需回溯 `ai/docs/` 原文与项目源码实现。

- 业务域 / 模块清单以 `ai/docs/summary/repo-summary.md` 与当前项目源码结构为动态来源，规划态见 `AGENTS.md`；**不在 prompt 中硬编码模块名**。

## 7. 阶段与门禁（默认 page-delivery 主流程）

阶段：需求提炼 → 模块扫描 → 交互与方案对齐 → Frontend 实现 → 校验 → 交付前审查。

通用 Gate（具体由 `tools/ai-orchestrator` 的 transitions / approvals 强制，详见各角色文件的差异条款）：

- 未完成需求提炼 + 模块扫描，不进入实现。
- 未完成人工收敛确认，不定版 `run-summary`、不分发正式 packet。
- 涉及新增界面 / 列表 / 树表 / 表单 / 弹窗 / 抽屉 / 配置 / 多状态界面时，未产出并确认 RUN 级 UX 交互稿、未登记 `current_ux_interaction`、未把交互摘要写入 `role-packets/frontend.md`，不进入 Frontend。
- 涉及后端数据但未完成契约预检与 contract gap 结论，不进入 Frontend。
- 未完成 Frontend 初版人工确认，不进入 QA 正式验证。
- 未完成项目声明的静态校验（如代码风格检查 / 类型检查 / 本地化检查等，具体命令以 `project.yaml` 声明为准），不进入交付结论；执行命令以项目声明的包管理器 / 脚本为准，使用 fallback 时须在报告注明实际命令和原因。
- 界面未补齐相关状态（loading、空、错误、权限等，若适用），不得判定为可交付。
- 涉及文案改动但未说明本地化处理（若项目使用本地化），不得判定为可交付。
- 未完成交付前人工确认，不进入最终关闭；最终交付确认通过但未产出并登记 `ai/tests/cases/<RUN_ID>-final-test-cases.md`，不得关闭 RUN。

### RUN 分档（tier）

RUN 在 `ai:plan` 时按变更规模判定 `tier`，门禁链按档裁剪（由 scheduler 强制）：

- `light`：纯文案 / 小修 / 纯脚本 / 无前台交互变化——可跳过 UX 与 Review，但仍需静态校验、（必要时）本地化检查与人工确认。
- `standard`：单界面 / 局部功能扩展——默认主流程，UX 视是否触及多状态界面而定。
- `full`：新增界面、列表 / 树表 / 表单 / 配置 / 多状态界面、跨模块——完整门禁链，UX + Review 必经。

显式跳过任一默认阶段时，Lead 必须在 Gate 结论写明原因并取得人工确认。

### 返工熔断

多轮"修改 → QA → 回归"允许进行，但受 `reworkRounds` 上限约束（由 run-state 强制）；触顶必须升级人工裁决，不得无限回流。

## 8. 真实链路八问

定义核心真实链路时必须回答：① 从哪个业务动作开始；② 谁使用；③ 使用前后发生什么；④ 数据从哪来到哪去；⑤ 结果由谁确认；⑥ 失败/异常怎么处理；⑦ 依赖哪些客户/第三方条件；⑧ 最终验收看什么。功能点清单与真实链路清单是两类一等产物，必须分开输出。

## 9. 自主学习闭环

当用户纠正关键判断、QA/Review 误判、验收口径变化或同类问题重复出现时，必须执行 `ai/workflows/self-learning-workflow.md`：先修正当前产物，再评估是否沉淀到 `ai/memory/learned-rules.md`，并按需更新相关 prompt / workflow，在 Gate 结论中写明学习闭环是否完成。生成测试矩阵 / 问题清单 / 收敛界面类型前必须读取并应用 `ai/memory/learned-rules.md`。

## 10. 任务对接群（Task Channel）

每个 `RUN_ID` 有一条任务对接群,贯穿全链路协作:

- **事实源 vs 呈现层**:群的事实源是 RUN 事件流 `ai/runtime/events/<RUN_ID>.jsonl`;人类可读投影是 `ai/context/runs/<RUN_ID>/channel.md`;若配置了 IM(Slack/飞书),事件会**自动出站播报**到真实群(配置见 `tools/ai-orchestrator/.env.example`)。
- **发言动词**:角色在群里发言用 `ai:post -- --run <RUN> --from <role> --to <role|all> --kind <kind> --task <id> --text "..."`,`kind ∈ {dispatch, claim, done, handoff, reject, pass, note}`。
- **建群开场**:`ai:plan` 首次创建 RUN 时,自动由 Lead 在群里播报一条 `open`(建群集合)消息,召集本轮参与身份;重复 plan 不再刷开场。
- **关键节点必须发群**:产品派发(`dispatch`)、角色领取(`claim`)、开发完成并交接(`done`)、QA 打回(`reject`)、QA 通过(`pass`)、Review 结论。开工前先读 `channel.md` 了解上下文。
- **群只是沟通层,不替代门禁**:`ai:post` 只记录消息+播报,**不改运行态、不推进 Gate**。状态推进仍走 `ai:run` / `ai:artifact` / `ai:approve` / `ai:retry` 与 §7 的人工确认门禁。例如:开发 `ai:post --kind done` 后,交接 QA 仍需登记 `current_frontend_handoff` 并经人工确认;QA `ai:post --kind reject` 后,返工仍走 `ai:retry`(受 §7 返工熔断约束)。
- **入站限制**:当前仅支持出站(harness→群);在 IM 里打字反向驱动 harness 需要常驻 bot 服务,属后续 Phase,暂以 CLI 动词为准。

## 11. 通用治理约束

- 所有关键决策、冲突、风险、遗留都要落文档（`ai/reports/change-log.md` 等），不接受只存在于聊天里的关键变更。
- 不把其他项目的目录、技术栈、脚本照搬进当前仓库；不假设存在当前仓库实际没有的目录结构。
- 对当前仓库不存在的能力显式标记"待建设"，不得伪装成已落地。
- 严禁直接改业务实现源码的角色：Lead / Product / Architecture / UX / QA / Review / Integration / Backend / DevOps（QA/Integration 在任务明确授权时方可改测试/校验资产，仍不得改业务实现）。
- 遵循项目既有的工程规范与类型/质量约束（如有），不得为图省事绕过项目声明的代码规范。
- 汇报语言：面向用户的交接 / 摘要 / 结论默认中文；代码注释、变量名、本地化 key 等按仓库自身的工程规范。
