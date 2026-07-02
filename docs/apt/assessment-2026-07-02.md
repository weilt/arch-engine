# APT 能力评估（2026-07-02，基于 v2.0.6 代码实证）

## 代码规模
- arch-engine: 82 源文件 / 487 KB
- mcp-server: 25 源文件 / 93 KB
- 测试: arch-engine 336 全绿; mcp-server 129 中 **3 个失败**（path-rules.test.ts）
- 模板: 57 个; 扫描器: 25 个; MCP 工具: 20 个; CLI: 5 个; 命令: 10 个

## 需立刻修复
- [P2] mcp-server path-rules.test.ts: 3 个测试失败（merges rules / extraSourceRoots / invalid prefix）

## v2.1.0 前必须解决的三个硬能力缺口（企业级商业前提）

1. **多仓库 workspace（当前 0/10）**
   - 大企业是几十个微服务 repo，单 repo 模式不满足
   - 这是企业版收费的核心功能
   - 路线图 v2.1

2. **RBAC + 审计日志 + 多租户（当前 0/10）**
   - "谁改了什么契约"是企业合规刚需
   - 没有这个过不了大客户的合规审批

3. **性能 benchmark（未验证）**
   - 500 万行 Java 的 start-init 耗时未知
   - query_impact 在数千方法节点下响应时间未知
   - 向量库大小未知
   - 跟企业客户谈必须有 SLA 数据

## 能力评分概览

- 多层架构图谱: 9/10（实体 AST + 流向 + 方法级调用图，无竞品）
- AI 编码治理闭环: 8.5/10（全链路 + 子 Agent 编排 + 自主闭环）
- Java 生态深度: 9/10（WebMvc 三级检测 + Feign + 路径规则覆盖）
- 设计知识层: 7.5/10（三源 ingest + 框架绑定 + v0 页面交接）
- 前端扫描: 6/10（import 图有，但 path alias / React 深度 / 数据流缺）
- 多 Agent 编排: 7/10（串行完整，无并行，429 处理弱）
- 增量扫描: 7/10（模块级，call-graph 无增量）
- 语言覆盖: 4/10（仅 Java + 前端，C#/Go/Rust/Python 未开始）
- 稳定性: 6/10（LLM 500 降级、3 个测试失败、网络敏感）

## 版本路线图
- 2.0.3 Entity + Flow Ontology — SHIPPED
- 2.0.4 Ontology Drill + AST Entity + RPC Flow + Scanner Registry — SHIPPED
- 2.0.5 Call Graph + Frontend Impact + refresh_asset Fix — SHIPPED
- 2.0.6 Java API 路径规则增强 + v0 页面交接 — SHIPPED
- **2.1.0 跨仓库 workspace + 多语言后端 — IN PROGRESS**

## 定位
APT 是"AI 编码治理基础设施"——不是编辑器、不是 autocomplete，是让 AI agent 在企业代码库里守规矩的护栏 + 路标。核心差异化是三层架构图谱 + 全链路治理闭环 + Java 生态深度。
