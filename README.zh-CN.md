# 🧪 LLM Bug-Ticket EvalLab

**一个支持断点续跑、具备配额感知能力的多模态大模型 Bug 工单评估平台**

🌐 **语言**：[English](./README.md) | 简体中文

---

## 🚀 项目简介

**LLM Bug-Ticket EvalLab** 是一个用于评估大模型在  
**「根据 UI 录屏视频生成 Bug 工单」** 任务上的评估平台。

与常见的 prompt demo 不同，本项目重点关注：

- ✅ 评估结果的正确性
- ✅ API 配额受限场景下的可持续运行
- ✅ 更贴近真实业务的工程化评估流程

整体设计参考了真实公司内部的 **模型评估 / 效果对比 / 产品决策工具**。

---

## ✨ 核心功能

### 🎥 多模态 Bug 工单生成
- 输入：短时 UI 操作录屏视频（包含崩溃场景）
- 输出：结构化 Bug 工单（JSON）
- 模型：Gemini（视频 + 文本）

#### 生成的 Bug 工单包含：
- `title`
- `steps`（复现步骤）
- `expected` / `actual`
- `environment`
- `severity`
- `tags`
- `confidence`

---

### 📐 严格的 Schema 校验
所有模型输出都会经过 Schema 校验，包括：
- 必填字段检查
- 类型校验
- 环境信息子结构校验
- 严重级别取值约束

不符合规范的输出会被明确记录，并从质量指标中剔除。

---

### 📊 评估指标解耦设计

为避免误导性结论，评估指标被拆分为两类：

#### Overall（整体指标）
- `json_parse_rate`
- `schema_complete_rate`
- `steps_compliance_rate`
- `avg_severity_rule_score`
- `avg_latency_ms`

#### Quality-Only（质量指标）
仅在 **成功完成推理的样本** 上计算，用于：
- 避免配额 / 权限 / 网络问题影响模型能力判断

---

### 🧠 基于规则的质量评估
针对 Bug 严重程度预测，使用规则进行评分：
- 与标注严重级别对比（如有）
- 基于关键词的严重级别期望（如“崩溃” → high / critical）
- 输出标准化评分结果

---

### 🚨 推理异常的结构化分类
推理失败不会被简单视为“错误”。

每条推理异常都会被结构化分类，例如：

```json
{
  "type": "quota_exhausted",
  "code": 429,
  "retryable": true
}
```

#### 支持的类型包括：

* `quota_exhausted`
* `auth_or_permission`
* `auth_key_leaked`
* `timeout_or_network`
* `unknown`

用于后续重试策略与运行诊断。

---


### ♻️ 支持断点续跑的评估任务

评估任务支持断点续跑：

* 每次运行保存在 `storage/runs/<run_id>/`
* 样本级结果持续 checkpoint
* 使用相同 `run_id` 重跑时会自动跳过已完成样本

适合在免费或低配额 API 环境下逐步完成大规模评估。

---

## 🏗️ 系统结构

```
frontend/          # React + TypeScript 前端
backend/
  ├── app.py       # FastAPI 后端
  ├── datasets/    # 版本化评估数据集
  ├── prompts/     # Prompt 版本（v0 / v1 / v2）
  ├── rules/       # 评估规则
  └── storage/
      └── runs/
          └── <run_id>/
              ├── config.json
              ├── raw_outputs.jsonl
              ├── parsed_outputs.jsonl
              ├── failures.json
              ├── eval.json
              └── eval_summary.json
```

---

## 🧰 技术栈

* 后端：Python, FastAPI, Pydantic
* 模型接口：Gemini 多模态 API
* 存储：JSON / JSONL（文件级 checkpoint）

---

## 🗺️ 后续规划

* 🔁 针对可重试异常的自动重试机制
* 🏆 多次运行结果的 Leaderboard 展示
* 📦 更多评估模态（日志、堆栈信息等）
* 🔌 模型无关的推理适配层
