# 长寿终局报告定向复放

- 源 case SHA-256：`ce0a1693491e984e7775b10a560822db0c04bc9118fa4329c206fab44c44a653`
- 模型：`deepseek-v4-flash`
- 重复次数：3

| 次数 | Provider 调用 | 质量修复 | 财务修复 | 不同历史索引 | 40岁前 | 40–59岁 | 60岁后 | 质量问题 | 财务问题 |
|---:|---:|---|---|---:|---|---|---|---:|---:|
| 1 | 2 | 否 | 否 | 0 | 否 | 否 | 否 | 1 | 0 |
| 2 | 2 | 否 | 否 | 0 | 否 | 否 | 否 | 1 | 0 |
| 3 | 2 | 否 | 否 | 0 | 否 | 否 | 否 | 1 | 0 |

## 第 1 次

- 生成失败：终局报告定向修复后仍未通过统一校验：report.futureTrends[1].trend:REPORT_FINANCIAL_PRECISION；report.futureTrends[1].reason:REPORT_FINANCIAL_PRECISION

## 第 2 次

- 生成失败：终局报告定向修复后仍未通过统一校验：report:FINAL_REPORT_UNGROUNDED_SCALE_CLAIM；share.viralTitle:REPORT_UNSUPPORTED_FINANCIAL_AMOUNT；report.futureTrends[1].trend:REPORT_FINANCIAL_PRECISION

## 第 3 次

- 生成失败：终局报告定向修复后仍未通过统一校验：report.futureTrends[1].trend:REPORT_FINANCIAL_PRECISION；report.futureTrends[1].reason:REPORT_FINANCIAL_PRECISION；report.futureTrends[1].reason:REPORT_DEBT_COMPLETION_CONFLICT
