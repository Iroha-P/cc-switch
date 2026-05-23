# Quick Switch 统一账号池使用指南

本文档说明如何使用 CC Switch 的 Quick Switch 统一账号池，在 Claude Code 和 Codex CLI 之间统一管理多组 API Key 与账号登录配置，并在当前账号额度用完后快速切换到下一个可用账号。

## 功能定位

Quick Switch 面向高频使用 CLI 助手的场景：

- 一个面板同时查看 Claude Code 与 Codex CLI 的可用账号。
- API Key Provider 与 OAuth / Account Login Provider 可以混排在同一个账号池中。
- 当前账号额度用完时，可以一键标记为已用完并切到下一个可用账号。
- 切换后优先恢复最近一次本地会话，尽量保持工作目录和对话上下文不断层。

目前 Quick Switch 只管理 CLI 侧配置：

| 目标           | 是否支持     | 说明                                                                 |
| -------------- | ------------ | -------------------------------------------------------------------- |
| Claude Code    | 支持         | 写入 `~/.claude/settings.json`，通常可热加载                         |
| Codex CLI      | 支持         | 写入 `~/.codex/auth.json` / `~/.codex/config.toml`，建议新开终端生效 |
| Claude Desktop | 不在本功能内 | Desktop 有独立 3P profile 管理                                       |
| Codex Desktop  | 不在本功能内 | 桌面端登录态与 CLI 配置分离，不会被 Quick Switch 改写                |

## 核心概念

### Provider 就是一个账号槽位

在 CC Switch 里，每个 Provider 都可以看作一个账号槽位。它可以是：

- API Key：直接保存 API Key、Base URL、模型等配置。
- Account Login / OAuth：保存账号登录态或 OAuth 相关配置。
- Local Config：仅指向本机已有 CLI 配置。

Quick Switch 不要求你把 API Key 和账号登录分开管理。只要 Provider 归属于 Claude Code 或 Codex CLI，它就会进入对应应用的账号池。

### Available 与 Used up

Quick Switch 给每个账号增加一个本地状态：

- Available：可继续使用，会参与“切下一个”。
- Used up：已用完或暂时不想使用，会被“切下一个”跳过。

这个状态只保存在当前电脑的浏览器本地存储中，键名为：

```text
cc-switch.quick-switch.account-status
```

它不会修改 Provider 本身，也不会删除 API Key 或账号登录信息。你随时可以在 Quick Switch 里把账号从 Used up 标回 Available。

## 配置多账号

### Claude Code 多账号

1. 打开 CC Switch 的 Claude 面板。
2. 为每个账号新增一个 Provider。
3. 如果是 API Key 账号，填写 API Key、Base URL、模型等字段。
4. 如果是账号登录或 OAuth 类型，按对应 Provider 的要求完成登录或导入。
5. 给 Provider 起一个容易识别的名字，例如：
   - `Claude Pro - main`
   - `Claude API - work`
   - `Anthropic Key - backup 01`

Claude Code 的切换会写入：

```text
~/.claude/settings.json
```

多数情况下 Claude Code 会自动感知配置变化。如果当前 Claude Code 进程没有刷新，重新打开终端或重启 Claude Code 即可。

### Codex CLI 多账号

1. 打开 CC Switch 的 Codex 面板。
2. 为每个 Codex CLI 账号新增一个 Provider。
3. API Key 账号填写 OpenAI / 兼容服务的 Key、Base URL 与模型配置。
4. OAuth 或 ChatGPT 登录类账号使用对应 Provider 完成登录态配置。
5. 用名称区分 CLI 与 Desktop，例如：
   - `Codex CLI - ChatGPT main`
   - `Codex CLI - API key backup`
   - `Codex CLI - work OAuth`

Codex CLI 的切换会写入：

```text
~/.codex/auth.json
~/.codex/config.toml
```

Codex CLI 通常在新进程启动时读取配置。切换后建议使用 Quick Switch 打开的新终端继续工作，或手动关闭旧终端后重新启动。

## 使用 Quick Switch

### 打开面板

在应用顶部工具栏点击 Quick Switch 图标，进入统一账号池页面。

页面会显示两个账号池：

- Claude Code
- Codex CLI

每个账号池会显示当前启用的账号、账号总数，以及每个 Provider 的类型和状态。

### 一键切下一个可用账号

点击账号池右上角的 `Next`：

1. Quick Switch 会从当前账号之后开始查找。
2. 跳过所有 Used up 账号。
3. 找到下一个 Available 账号后执行真实 Provider 切换。
4. 如果存在最近一次本地会话恢复命令，会自动打开终端恢复该会话。
5. 如果没有可恢复会话，会打开对应 Provider 的普通终端。

账号顺序使用你在 CC Switch 里配置的 Provider 顺序。你可以在 Provider 管理页面调整排序。

### 当前账号用完后继续

当当前账号额度用完，点击 `Use next`：

1. 当前账号会被标记为 Used up。
2. Quick Switch 自动跳到下一个 Available 账号。
3. 切换成功后优先恢复最近一次本地会话。

这就是推荐的连续工作流程：账号用完时点一次 `Use next`，不用先手动切 Provider，再手动找会话恢复命令。

### 手动标记账号状态

每张账号卡片都有状态按钮：

- 点击 `Used up`：把该账号标记为已用完。
- 点击 `Available`：恢复为可用账号。

如果你只是临时不想用某个账号，也可以把它标为 Used up。之后需要时再标回 Available。

## 上下文连续性说明

Quick Switch 会尽量保持工作不断层，但需要区分两类上下文：

### 本地会话上下文

CC Switch 的 Sessions 功能会记录本地 CLI 会话。如果最近的会话有可恢复命令，Quick Switch 会在切换账号后调用该恢复命令并打开终端。

这能保留：

- 当前项目目录。
- CLI 本地记录的会话恢复入口。
- 已保存到本机的历史对话或 resume 信息。

### 服务端账号上下文

不同 API Key 或不同账号登录属于不同上游身份。上游服务端是否共享历史对话、缓存、额度窗口或项目记忆，取决于服务商本身。

因此 Quick Switch 能做的是：

- 尽量恢复本地 CLI 会话。
- 尽量回到同一个项目目录。
- 尽量减少手动切账号和手动恢复会话的步骤。

它不能保证不同账号之间共享服务端侧的隐藏上下文。如果某个 CLI 或上游服务要求同一账号才能继续完整服务端线程，切到另一个账号后可能需要 CLI 自己重新发送必要上下文。

## 推荐工作流

1. 先在 Claude 和 Codex 面板分别配置好所有 Provider。
2. 把账号按优先级排序，最常用的放前面，备用账号放后面。
3. 进入 Quick Switch。
4. 开始工作时使用当前账号。
5. 当前账号额度用完后点击 `Use next`。
6. 如果某个账号额度恢复了，把它从 Used up 标回 Available。

对于需要长时间连续工作的场景，建议保持 CC Switch 常驻，并使用它打开的终端继续会话。

## 常见问题

### API Key 登录能和账号登录同时使用吗？

可以。Quick Switch 会把 API Key Provider 与 Account Login / OAuth Provider 放在同一个账号池中。切换时只看 Provider 是否属于当前应用，以及它是否处于 Available 状态。

### 为什么要区分 Codex CLI 和 Codex Desktop？

Codex CLI 使用本机 CLI 配置文件，例如 `~/.codex/auth.json` 和 `~/.codex/config.toml`。Codex Desktop 使用桌面应用自己的登录态和运行环境。

Quick Switch 只改 CLI 配置，不会触碰桌面端登录状态。这样可以避免把桌面端正在使用的账号意外切走。

### 点击切换后旧终端没有变化怎么办？

Codex CLI 通常需要新进程读取新配置。请使用 Quick Switch 自动打开的新终端，或关闭旧终端后重新启动 Codex CLI。

Claude Code 一般可以热加载配置，但如果没有刷新，也可以重新打开终端。

### 提示没有可用账号怎么办？

检查该应用账号池里是否所有账号都被标记为 Used up。把至少一个账号标回 Available 后再点击 `Next` 或 `Use next`。

### 如何重置所有 Used up 标记？

推荐在 Quick Switch 页面逐个把账号标回 Available。

如果需要完全重置，也可以在浏览器开发者工具或应用本地存储中删除：

```text
cc-switch.quick-switch.account-status
```

删除后重新打开页面，所有账号都会恢复为 Available。

### 会不会删除我的账号或 API Key？

不会。Quick Switch 的 Used up / Available 只是本地状态标记，不会删除 Provider，也不会清空 API Key。

真正的账号切换仍然调用 CC Switch 原有 Provider 切换逻辑，写入目标 CLI 的配置文件。

## 排错清单

如果 Quick Switch 没有按预期工作，按下面顺序检查：

1. Claude 或 Codex 面板里是否已经配置了多个 Provider。
2. Provider 是否属于正确应用，例如 Codex CLI Provider 不会出现在 Claude Code 池中。
3. 目标账号是否被标记为 Used up。
4. Codex CLI 是否在切换后重新打开了终端。
5. 最近会话是否有可恢复命令；没有时 Quick Switch 会退回到普通打开终端。
6. Provider 本身是否能在原始 Provider 页面手动启用。

## 适合与不适合的场景

适合：

- 多个 API Key 轮换使用。
- API Key 与 OAuth 账号混合使用。
- Claude Code 与 Codex CLI 都需要频繁切换账号。
- 希望账号用完后快速继续当前项目。

不适合：

- 需要切换 Claude Desktop 或 Codex Desktop 登录态。
- 要求不同账号共享完全相同的服务端对话线程。
- 希望自动判断上游额度是否真的用完。当前版本需要用户手动标记 Used up。
