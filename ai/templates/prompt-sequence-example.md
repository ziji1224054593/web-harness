# Prompt Sequence Example / Prompt 调用顺序示例

## Standard Sequence / 标准顺序

0. Lead Orchestrator  
   Read summary docs first, decide the business domain, and prepare the run context. / 先读取 summary 文档，判断业务域并准备本轮上下文。

1. Product Agent  
   Refine the raw requirement into scope, user paths, exception scenarios, and open questions. / 把原始需求整理成范围、用户路径、异常场景和待确认项。

2. Architecture Agent  
   Then align module boundaries, contract inputs, state strategy, and impacted directories. / 再确认模块边界、契约输入源、状态策略和目录影响。

3. UX Agent  
   Output page flows, state matrix, component mapping, and key interactions when extra UX support is needed. / 在确实需要额外设计支持时输出页面流程、状态矩阵、组件映射和关键交互。

4. Lead Orchestrator  
   Summarize Product / Architecture / UX conclusions into `run-summary` and dispatch role packets. / 把 Product / Architecture / UX 的结论汇总成 `run-summary` 并分发角色 packet。

5. Frontend Agent  
   Read the `frontend` packet and the relevant module implementation, then do the minimum code implementation. / 读取 `frontend packet` 和模块现有实现，再做最小代码实现。

6. Integration Agent  
   Check contract differences and integration risks only when the task needs contract validation. / 仅在任务需要契约核对时检查差异和联调风险。

7. QA Agent  
   Read the `qa` packet, then generate the test matrix and validation conclusions. / 读取 `qa packet` 后生成测试矩阵和验证结论。

8. Review Agent  
   Read the `review` packet and perform the final read-only review before delivery. / 读取 `review packet` 后做交付前只读审查。

## Notes / 说明

- If the requirement is very small, Product + Architecture can be merged, but `Lead Orchestrator` should still output a lightweight run summary. / 如果需求很小，可以合并 Product + Architecture，但 `Lead Orchestrator` 仍应输出轻量级 run summary。
- Even for a small frontend-only change, do not skip module scanning. / 如果只是前端局部改动，也不能跳过模块扫描。
- If the repository does not yet have automated tests, QA should first output a test checklist and validation report. / 如果仓库还没有自动化测试，QA 先输出测试清单和验证报告。
- Frontend / QA / Review should prefer packets over rereading the full `ai/docs/` tree. / Frontend / QA / Review 应优先读取 packet，而不是重读整个 `ai/docs/`。
