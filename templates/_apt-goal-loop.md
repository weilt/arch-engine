## /apt-goal 循环片段

单会话 5 步循环（spec §3.2）。每轮严格遵守，禁止跳步。

### 1. `query_project_status`（必须，每轮起点）

调用只读 MCP 工具 **`query_project_status`** 获取 `ProjectStatus`。

### 2. 终止判定

若 **`loopDone === true`** → 输出交付摘要（goal、完成范围、verify 结果），结束 loop。

### 3. 阻塞判定

若 **`blockers`** 非空 → **停住报告**，不得继续。典型高风险阻塞：

- spec 未批准（高风险 brainstorming 待人审）
- 缺 `agent-init`（无 `last-scan.json`）
- 缺 `last-scan.json` 等

向用户说明阻塞项与建议动作。

### 4. 按 `nextAction` 执行唯一子流程

| `nextAction` | 子流程 |
|--------------|--------|
| `auto_brainstorm` | 跑 **`/auto-brainstorm`** 生成 spec 并风险分级 |
| `await_spec_approval` | **停止**，待人审批 spec（不跑命令） |
| `plan_from_spec` | 跑 **`/plan-from-spec`** |
| `implement_plan` | 跑 **`/implement-plan`**（**子 Agent 串行**，主 Agent 编排，禁止 inline 编码） |
| `feature` | 跑 **`/feature`**（退路：无独立 spec/plan 时的全流程） |
| `verify` | 跑 **`/verify`**，结果写入 **`.apt/verify/latest.md`** |
| `finish_feature` | 跑 **`/finish-feature`**（写侧补救） |
| `start_init` | 提示用户执行 `start-init`，并将状态标记 `blocked` |
| `none` | `loopDone`，结束 loop |

### 5. 子流程结束 → 回到 1

每个子流程完成后：**刷新 `status.json`** → 回到步骤 1（`query_project_status`）。

## 硬规则

- **禁止**在 `implement_plan` / `feature` 阶段由主 Agent inline 编码（一律子 Agent 串行）。
- **禁止**跳过 `verify`；`loopDone` 必须由 verify PASS 驱动。

## platform-loop resume 配方（spec §3.4）

跨会话恢复用 platform `/loop` 调度：

- 通用 recipe：`/loop until apt-status reports loopDone: /apt-goal --continue`
- Cursor `stop` hook：读取 `apt-status --json`，若 `loopDone` 未真则注入 followup `/apt-goal --continue`（完整 hook 见 `templates/hooks/cursor-stop-apt.example.ts`，由后续 unit 提供）。
