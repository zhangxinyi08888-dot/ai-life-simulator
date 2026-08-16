## 一、标注任务规范解读

这是一套**个人/家庭财务支出责任的文本标注规范**，用于从自然语言叙述中提取结构化的支出责任事实，采用独立盲审模式，仅基于文本可见内容标注，不得参考任何外部文件。

### 核心标注规则

1. **事实唯一原则**：仅标注叙述文本中明确可见的支出责任事实，不得依赖检测器、账本、审计等外部信息。
2. **空标注条件**：仅当叙述中完全不存在任何支出责任相关事实时，`annotations` 保留空数组。
3. **坐标系统**：字符区间采用 UTF-16 半开区间 `[start, end)`（左闭右开），按UTF-16码元计数，中文、数字、标点均占1个码元。

### 核心字段定义

#### 必填字段

| 字段 | 含义 | 取值规则 |
| --- | --- | --- |
| `annotationId` | 单条标注唯一标识 | 单条示例内按 `A-01`、`A-02` 顺序编号 |
| `disposition` | 处置分类 | `material`：实质性支出（主角/家庭已确定、正在发生的有效支出）   `review`：待复核支出（主角计划中、考虑中、未落地的支出）   `ignore`：忽略项（公司经营支出、他人独立承担的支出、收入项等与主角无关的支出） |
| `responsibilityKey` | 支出责任主体 | 如 `protagonist`（主角/你）、`partner`（伴侣）、`company`（公司）、`unknown`（主体未知）等 |
| `responsibilityKind` | 支出类型 | 如 `rent`（房租/住房）、`medical`（医疗/药品/康复）、`care`（照护/家政）、`childcare`（托育）、`insurance`（保险） |
| `completion` | 执行状态 | `ongoing`：持续进行中；`planned`：计划中未执行 |
| `cadence` | 支付周期 | `monthly`（按月）、`quarterly`（按季度）、`yearly`（按年） |
| `liability` | 承担方式 | `sole`（独自承担）、`shared`（共同承担）、`unknown`（归属未知） |
| `financialScope` | 财务范围 | `personal`（个人/家庭生活类）；`business`（公司/经营类） |
| `spans.responsibility` | 支出描述的文本区间 | 对应核心支出责任描述的字符起止位置 |

#### 可选字段

- `grossMonthlyAmountWan`：该项支出的月总金额，单位：万元
- `protagonistMonthlyAmountWan`：主角承担的月金额，单位：万元
- `householdShareRate`：共同支出中主角的分担比例（如0.5表示承担一半）
- `notes`：补充备注

---

## 二、全量示例标注结果

以下严格按照规范对所有示例完成标注，仅对明确的支出责任事实生成条目，无歧义事实不额外增补。

### C 组（常规已发生支出场景）

#### C-01

```
{
  "id": "C-01",
  "narrative": "你已经每月支付房租5000元，未来再考虑搬家。",
  "narrativeSha256": "984e89566d348bbe2b9bf324cd7225f584925115d766f0920c2b590cdac3536c",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 14]
      }
    }
  ]
}
```

#### C-02

```
{
  "id": "C-02",
  "narrative": "你计划下月开始支付房租5000元。",
  "narrativeSha256": "4462e6b5c09c767ee743771730c834e12598bbb727bed4d6358c218369ff24a3",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 14]
      }
    }
  ]
}
```

#### C-03

```
{
  "id": "C-03",
  "narrative": "你每月支付房租5000元，伴侣每月承担父母医疗1200元。",
  "narrativeSha256": "c9e0da667ff286adfd6466e3bc5f51bc26650752d874c57dd7254ada2588c09d",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 10]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "partner",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0,
      "spans": {
        "responsibility": [11, 23]
      }
    }
  ]
}
```

#### C-04

```
{
  "id": "C-04",
  "narrative": "你们每月共同支付房租5000元，你每月单独承担父母医疗1200元。",
  "narrativeSha256": "6c393999b5314aaff18392ae2562b23c1a2e1629419cfb3f533211417d03cb10",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist,partner",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "shared",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 13]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [14, 28]
      }
    }
  ]
}
```

#### C-05

```
{
  "id": "C-05",
  "narrative": "你每月到手工资1.8万，你支付房租5000元，并为自己每月购买慢病药物1200元。",
  "narrativeSha256": "ffc407f0c9f81eaaad10fcc8bb29b26e96603839335fcdff06cc6fd0021f5d18",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [10, 20]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [24, 36]
      }
    }
  ]
}
```

#### C-06

```
{
  "id": "C-06",
  "narrative": "你已经承担这套长期租住房屋的固定成本，考虑到父亲复查时的交通、日常买菜和工作通勤等安排仍会持续很多年，这笔住房固定成本每月由你支付5000元。",
  "narrativeSha256": "a347a8bca94e7bfe05c9edbd8fd18a421d84516f1744b98a407b0fe19c050d9b",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [48, 62]
      },
      "notes": "交通、买菜、通勤仅提及持续，无明确金额与支付责任，不予标注"
    }
  ]
}
```

#### C-07

```
{
  "id": "C-07",
  "narrative": "你已经开始承担房租和父亲的长期用药费，每月总共5000元。",
  "narrativeSha256": "83d5f18d67af0907a67733d86e1a8322bdabd82ffcc05922a3e707b5f88c612f",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "spans": {
        "responsibility": [7, 9]
      },
      "notes": "两项支出合计5000元/月，未拆分单项金额"
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "spans": {
        "responsibility": [10, 18]
      },
      "notes": "两项支出合计5000元/月，未拆分单项金额"
    }
  ]
}
```

#### C-08

```
{
  "id": "C-08",
  "narrative": "你与父亲商量后决定请一位钟点工每周来三天帮忙做午饭和打扫，费用由你承担，每月1200元；次周已经上门。",
  "narrativeSha256": "7348cd96e732e690c0d51af1c8b835c9df3c1b7a0b8ba2277e2c427fafc43b8a",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "care",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [12, 38]
      }
    }
  ]
}
```

#### C-09

```
{
  "id": "C-09",
  "narrative": "你考虑请一位护工照看父亲，每月预计4000元。",
  "narrativeSha256": "d039e6007b3a53577e39b73e86136c1895f799200b4073d6cdf7aef312b2a4ee",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "care",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.4,
      "protagonistMonthlyAmountWan": 0.4,
      "spans": {
        "responsibility": [0, 18]
      }
    }
  ]
}
```

#### C-10

```
{
  "id": "C-10",
  "narrative": "公司为木工坊每月支付租金3000元，你则继续每月支付个人房租5000元。",
  "narrativeSha256": "192c4416b704b78c6d7966181df2b62e51a3c54b6828af310c0102253d15f585",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "company",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "business",
      "grossMonthlyAmountWan": 0.3,
      "spans": {
        "responsibility": [0, 14]
      },
      "notes": "公司经营类支出，不属于个人/家庭财务范围"
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [15, 29]
      }
    }
  ]
}
```

#### C-11

```
{
  "id": "C-11",
  "narrative": "你把闲置公寓出租，每月租金3000元转入你的账户。",
  "narrativeSha256": "b41ffc9a1d7ee17312ba692b35d1f4bc76afee8f7c5312edabcecfa6aad70081",
  "reviewed": true,
  "annotations": [],
  "notes": "仅描述租金收入，无支出责任事实"
}
```

#### C-12

```
{
  "id": "C-12",
  "narrative": "你每月支付自己的慢病用药600元，父亲的降压药800元由姐姐承担。",
  "narrativeSha256": "4af77cf59f325899211aa5e90f716266073574f37dd517fd1941b212ab1cd06f",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.06,
      "protagonistMonthlyAmountWan": 0.06,
      "spans": {
        "responsibility": [0, 13]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "ignore",
      "responsibilityKey": "sister",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.08,
      "spans": {
        "responsibility": [14, 26]
      },
      "notes": "姐姐独立承担，不属于主角支出责任"
    }
  ]
}
```

#### C-13

```
{
  "id": "C-13",
  "narrative": "你已经连续两年每月支付自己的房租4800元和父亲照护费2000元。",
  "narrativeSha256": "860b1030b91b87c61cb771ae0ae261907a23e4c19497da27611a46cd1888a673",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.48,
      "protagonistMonthlyAmountWan": 0.48,
      "spans": {
        "responsibility": [9, 18]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "care",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.2,
      "protagonistMonthlyAmountWan": 0.2,
      "spans": {
        "responsibility": [19, 28]
      }
    }
  ]
}
```

---

### P 组（计划/混合场景）

#### P-14

```
{
  "id": "P-14",
  "narrative": "孩子出生后，你们共同承担每月托育费6000元，各自承担一半。",
  "narrativeSha256": "5e2c0a975b3ce098cf47990b609d2e87fa179346f6f5de0cd9be67cea77fcbaf",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist,partner",
      "responsibilityKind": "childcare",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "shared",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.6,
      "protagonistMonthlyAmountWan": 0.3,
      "householdShareRate": 0.5,
      "spans": {
        "responsibility": [0, 22]
      }
    }
  ]
}
```

#### P-15

```
{
  "id": "P-15",
  "narrative": "你每月缴纳医疗险400元，伴侣自行承担她的重疾险900元。",
  "narrativeSha256": "326c629ef3561887238827ccc0b8260dffe0756b3989fdbb2da2a098ceb70f7d",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "insurance",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.04,
      "protagonistMonthlyAmountWan": 0.04,
      "spans": {
        "responsibility": [0, 9]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "partner",
      "responsibilityKind": "insurance",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.09,
      "protagonistMonthlyAmountWan": 0,
      "spans": {
        "responsibility": [10, 22]
      }
    }
  ]
}
```

#### P-16

```
{
  "id": "P-16",
  "narrative": "你们共同租住公寓，月租5200元，各自承担一半；你单独承担母亲每月复查药费800元。",
  "narrativeSha256": "2564fddbc1bf9889a15521dbd0168de8547ef8bc840c708bbfafbfa983e9b80",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist,partner",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "shared",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.52,
      "protagonistMonthlyAmountWan": 0.26,
      "householdShareRate": 0.5,
      "spans": {
        "responsibility": [0, 16]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.08,
      "protagonistMonthlyAmountWan": 0.08,
      "spans": {
        "responsibility": [19, 32]
      }
    }
  ]
}
```

#### P-17

```
{
  "id": "P-17",
  "narrative": "你已开始每月支付父亲康复训练2000元，但准备下季度把自己的保险升级到1200元。",
  "narrativeSha256": "a32aa60c5db41cc07cefbe5434338066ae6b752826453a3c0540527963524d6c",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.2,
      "protagonistMonthlyAmountWan": 0.2,
      "spans": {
        "responsibility": [0, 15]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "insurance",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [18, 32]
      }
    }
  ]
}
```

#### P-18

```
{
  "id": "P-18",
  "narrative": "你已经每月支付孩子托班费3500元，同时计划明年改读每月6000元的国际课程。",
  "narrativeSha256": "2caf1b6f8b5a3b8c4d748a4afcc20c1d7acf1d7334775146ea16aa9b6681302b",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "childcare",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.35,
      "protagonistMonthlyAmountWan": 0.35,
      "spans": {
        "responsibility": [0, 13]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "childcare",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.6,
      "protagonistMonthlyAmountWan": 0.6,
      "spans": {
        "responsibility": [16, 30]
      }
    }
  ]
}
```

#### P-19

```
{
  "id": "P-19",
  "narrative": "你正在支付现在公寓房租4800元，未来准备搬到月租7500元的新房。",
  "narrativeSha256": "320dd52a9a93bdf40b61cfac546cc038604bd765eac708f3045ab3c8579a012d",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.48,
      "protagonistMonthlyAmountWan": 0.48,
      "spans": {
        "responsibility": [0, 13]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.75,
      "protagonistMonthlyAmountWan": 0.75,
      "spans": {
        "responsibility": [14, 28]
      }
    }
  ]
}
```

#### P-20

```
{
  "id": "P-20",
  "narrative": "你已为自己每月购买慢病药800元，考虑未来改用每月1500元的新疗法。",
  "narrativeSha256": "20f6f9bd245cc66e2a56093affe6aba1d1ca2f51e182990beb02430dbaaee2c6",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.08,
      "protagonistMonthlyAmountWan": 0.08,
      "spans": {
        "responsibility": [0, 12]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "review",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "planned",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.15,
      "protagonistMonthlyAmountWan": 0.15,
      "spans": {
        "responsibility": [13, 28]
      }
    }
  ]
}
```

#### P-21

```
{
  "id": "P-21",
  "narrative": "每月房租5000元和父母医疗1200元已经发生，但没有写明由谁支付。",
  "narrativeSha256": "1138b1bcdd11f8b38faf8783bc7a05bb584d6f3d285d07d372e884d686400a46",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "unknown",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "unknown",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 8]
      },
      "notes": "支付主体未明确"
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "unknown",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "unknown",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [9, 18]
      },
      "notes": "支付主体未明确"
    }
  ]
}
```

#### P-22

```
{
  "id": "P-22",
  "narrative": "你同时承担两处住所：自住公寓房租5000元，父母暂住处租金3000元；两笔均由你支付。",
  "narrativeSha256": "98a545fef5e24ff6150cd61a0e0a24937d5c2ff564478c01040be3e6c56c509c",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "protagonistMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [7, 15]
      }
    },
    {
      "annotationId": "A-02",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.3,
      "protagonistMonthlyAmountWan": 0.3,
      "spans": {
        "responsibility": [16, 25]
      }
    }
  ]
}
```

#### P-23

```
{
  "id": "P-23",
  "narrative": "你已续缴年度医疗保险费2400元，按年缴纳。",
  "narrativeSha256": "cbb550d0ce3db6e1485575413c90d4d2a826b3560d44221cb0c78f6c82e471be",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "insurance",
      "completion": "ongoing",
      "cadence": "yearly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.02,
      "protagonistMonthlyAmountWan": 0.02,
      "spans": {
        "responsibility": [0, 14]
      },
      "notes": "年缴2400元，折算月均200元"
    }
  ]
}
```

#### P-24

```
{
  "id": "P-24",
  "narrative": "你为母亲持续支付康复课程，每季度3600元。",
  "narrativeSha256": "2ab22a103990e194197dfb94011a807b8d894c6d388b3efe9f0798172a3d377f",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist",
      "responsibilityKind": "medical",
      "completion": "ongoing",
      "cadence": "quarterly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.12,
      "protagonistMonthlyAmountWan": 0.12,
      "spans": {
        "responsibility": [0, 15]
      },
      "notes": "季度缴3600元，折算月均1200元"
    }
  ]
}
```

#### P-25

```
{
  "id": "P-25",
  "narrative": "你们共同支付每月房租5200元，但尚未商定各自份额。",
  "narrativeSha256": "ae4b2d6afe114613720b10735c3f6a4fb922f13b060a80358c973969941a1380",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "material",
      "responsibilityKey": "protagonist,partner",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "shared",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.52,
      "spans": {
        "responsibility": [0, 13]
      },
      "notes": "共同承担但份额未明确"
    }
  ]
}
```

---

### N 组（负例/无关支出场景）

#### N-01

```
{
  "id": "N-01",
  "narrative": "创业公司续租办公室，月租8000元由公司账户支付。",
  "narrativeSha256": "32dedb785b3c399589e290f6308c8a33163ec559bf15da3497e6e65372da57d2",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "company",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "business",
      "grossMonthlyAmountWan": 0.8,
      "spans": {
        "responsibility": [0, 20]
      },
      "notes": "公司经营支出，不属于个人/家庭范围"
    }
  ]
}
```

#### N-02

```
{
  "id": "N-02",
  "narrative": "客户为摄影工作室每月支付场地费3000元，这笔款进入公司账户。",
  "narrativeSha256": "308018c322374801a986d956b074f3a495e2af9b38ff531efdfe51e60787ec1d",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "client",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "business",
      "grossMonthlyAmountWan": 0.3,
      "spans": {
        "responsibility": [0, 16]
      },
      "notes": "客户支付的经营类费用，为公司收入，不属于主角支出"
    }
  ]
}
```

#### N-03

```
{
  "id": "N-03",
  "narrative": "你将旧房出租，每月租金4500元汇入你的银行卡。",
  "narrativeSha256": "653499fdaf009fda0cbc180333dec05d3d0f0c3946c4f43d5f01240ece9534c7",
  "reviewed": true,
  "annotations": [],
  "notes": "仅描述租金收入，无支出责任事实"
}
```

#### N-04

```
{
  "id": "N-04",
  "narrative": "伴侣将她名下的房子出租，每月收租4000元。",
  "narrativeSha256": "d4e02c7cf8b0c19732fbd17f9ee3ffacd8c4e38f2c2db6c9b048dd30665b15b2",
  "reviewed": true,
  "annotations": [],
  "notes": "仅描述租金收入，无支出责任事实"
}
```

#### N-05

```
{
  "id": "N-05",
  "narrative": "父母每月支付你的研究生学费6000元，你不承担这笔费用。",
  "narrativeSha256": "8680a63ce1ff97afd0cf6fffb09d90ca8742cfdd18aa4e81f45c1efc6be59f6e",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "parents",
      "responsibilityKind": "education",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.6,
      "spans": {
        "responsibility": [0, 14]
      },
      "notes": "父母独立承担，主角明确不承担该支出"
    }
  ]
}
```

#### N-06

```
{
  "id": "N-06",
  "narrative": "母亲每月替你支付房租5000元，你没有承担这笔支出。",
  "narrativeSha256": "457bc29d182c25efd5bddf3c0d49d9a9ee7e6e3aef71ce3177379890048658d5",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "mother",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 12]
      },
      "notes": "母亲独立承担，主角明确不承担该支出"
    }
  ]
}
```

#### N-07

```
{
  "id": "N-07",
  "narrative": "公司报销你为团队租用仓库的月费5000元，不计入个人生活账本。",
  "narrativeSha256": "bbc183995ebd39449378fa5f6d11fd3a333c1b71ffc251edb3e3775a38a243da",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "company",
      "responsibilityKind": "rent",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "business",
      "grossMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 18]
      },
      "notes": "公司报销的经营类支出，不计入个人生活开支"
    }
  ]
}
```

#### N-08

```
{
  "id": "N-08",
  "narrative": "叔叔每月支付父亲护工费用5000元，你只偶尔探望。",
  "narrativeSha256": "1541c9ece0ad89a457281fa727769d610117116f9fc55ba6fb908eb7a9d4eab5",
  "reviewed": true,
  "annotations": [
    {
      "annotationId": "A-01",
      "disposition": "ignore",
      "responsibilityKey": "uncle",
      "responsibilityKind": "care",
      "completion": "ongoing",
      "cadence": "monthly",
      "liability": "sole",
      "financialScope": "personal",
      "grossMonthlyAmountWan": 0.5,
      "spans": {
        "responsibility": [0, 14]
      },
      "notes": "叔叔独立承担，主角不承担该支出"
    }
  ]
}
```

---

如果需要调整字段枚举定义、补充更精细的span拆分，或者导出完整的JSON文件，可以随时告诉我。