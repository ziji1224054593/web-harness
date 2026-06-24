# Run Summary Template

## 1. Run Meta / 运行信息

- Run ID / 运行编号:
- Pipeline / 流水线:
- Target feature / 目标功能:
- Business domain / 业务域:
- Owner / 负责人:
- Owner role (ZH) / 负责角色中文名:
- Primary orchestrator / 主编排者:
- Runtime write mode / 运行态写策略:
- Coordination status / 协调状态:
- Current stage / 当前阶段:
- Run status / 运行状态:
- Run decision / 运行结论:
- Human confirmed? / 是否已人工确认:
- Confirmed by / 确认人:
- Confirmed at / 确认时间:
- Human confirmation checklist / 人工确认清单:

## 2. Goal / 本轮目标

-

## 3. Confirmed Scope / 已确认范围

-

## 4. Feature Points / 功能点清单

| ID     | Module / 模块 | Feature Point / 功能点 | Priority / 优先级 | Acceptance / 验收要点 |
| ------ | ------------- | ---------------------- | ----------------- | --------------------- |
| FP-001 |               |                        |                   |                       |

## 5. Real User/System Paths / 真实链路清单

| ID     | Path / 链路 | Actor / 触发方 | Entry / 入口 | Steps / 步骤摘要 | Success / 成功结果 | Failure / 异常分支 |
| ------ | ----------- | -------------- | ------------ | ---------------- | ------------------ | ------------------ |
| RP-001 |             |                |              |                  |                    |                    |

## 5A. Real Path Eight Questions / 真实链路八问

For each key real path, answer / 每条关键真实链路都要回答:

| Question / 问题                    | Answer / 回答 |
| ---------------------------------- | ------------- |
| 这个需求从哪个业务动作开始？       |               |
| 谁会使用它？                       |               |
| 使用前后分别发生什么？             |               |
| 数据从哪里来，又流向哪里？         |               |
| 结果由谁确认？                     |               |
| 失败或异常时怎么处理？             |               |
| 哪些环节依赖客户或第三方提供条件？ |               |
| 最终验收看什么？                   |               |

Each real path should define / 每条真实链路应说明:

- Preconditions / 前置条件:
- State changes / 状态变化:
- API / store / permission checks:
- Empty / error / permission branches:
- QA verification points / QA 验证点:

## 6. Page Map / 页面地图

| Page / 页面 | Entry / 入口 | Container / 形态 | Notes / 说明 |
| ----------- | ------------ | ---------------- | ------------ |
|             |              |                  |              |

## 7. Interaction Decisions / 交互决策表

| Scenario / 场景 | Decision / 已确认决策 | Source / 来源 | To Confirm / 待确认 |
| --------------- | --------------------- | ------------- | ------------------- |
| 查询触发方式    |                       |               |                     |
| 查询/重置按钮   |                       |               |                     |
| 分页与筛选联动  |                       |               |                     |
| 编辑入口形态    |                       |               |                     |
| 成功/失败反馈   |                       |               |                     |

## 8. Component Strategy / 组件复用与新增策略

- Existing patterns to reuse / 优先沿用的现有模式:
- Local components to add / 建议新增的局部组件:
- Shared components decision / 是否建议抽公共组件:

## 9. Out Of Scope / 本轮不做

-

## 10. Facts Read / 已读取事实源

- Summary docs / 摘要文档:
- Source docs / 原文文档:
- Code areas / 代码区域:

## 11. Key Decisions / 关键结论

-

## 11A. Human Confirmation Scope / 人工确认范围

- Confirmed in scope / 已确认范围:
- Confirmed out of scope / 已确认范围外:
- Confirmed feature points / 已确认功能点:
- Confirmed real paths / 已确认真实链路:
- Confirmed interaction decisions / 已确认交互决策:
- Confirmed component strategy / 已确认组件策略:
- Confirmed run strategy / 已确认 run 策略:
- Confirmed primary orchestrator / 已确认主编排者:
- Non-owner sessions limited to draft only? / 非主编排会话是否仅限草稿与建议:
- Approved for packet dispatch? / 是否批准进入 packet 分发:
- Rejection reason if rejected / 如驳回，驳回原因:
- Return owner if rejected / 如驳回，回退目标:
- Re-review entry point / 复审入口:

## 11B. Frontend Confirmation / Frontend 初版人工确认

- Frontend first version reviewed? / Frontend 初版是否已人工确认:
- Frontend confirmation notes / Frontend 确认说明:
- Key real paths walk through? / 关键真实链路是否走通:
- Interaction decisions implemented as confirmed? / 交互决策是否按确认内容落地:
- Component strategy followed? / 组件策略是否按约定执行:
- Approved for QA? / 是否批准进入 QA:
- Rejection reason if rejected / 如驳回，驳回原因:
- Return owner if rejected / 如驳回，回退目标:
- Re-review entry point / 复审入口:

## 11C. Pre-delivery Confirmation / 交付前人工确认

- QA and Review reviewed by human? / QA 与 Review 结果是否已人工确认:
- Final go / no-go decision / 最终放行或阻断结论:
- Follow-up required before close? / 关闭前是否仍需跟进:
- Rejection reason if rejected / 如驳回，驳回原因:
- Return owner if rejected / 如驳回，回退目标:
- Re-review entry point / 复审入口:

## 12. Risks And Open Questions / 风险与待确认项

-

## 12A. Coordination Notes / 协调说明

- Same-run auxiliary sessions / 同 run 辅助会话:
- Shared code-area conflict risk / 共享代码区域冲突风险:
- Handoff or ownership change needed? / 是否需要交接或变更主编排者:

## 13. Packet Dispatch Plan / 分发计划

- Product packet:
- Architecture packet:
- UX packet:
- Frontend packet:
- QA packet:
- Review packet:
- Optional support packets:

## 14. Gate Target / Gate 目标

- Current gate:
- Exit criteria:

## 15. Run Lifecycle / 生命周期

- Continue current run? / 是否继续沿用当前 run:
- Freeze condition / 冻结条件:
- Completion condition / 完结条件:
- Superseded by new run? / 是否被新 run 取代:
