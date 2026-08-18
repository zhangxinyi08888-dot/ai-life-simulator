# Career Compensation Authority Repair — Short Spec

Status: implemented and locally verified on the Web source branch

Baseline: `main@7ff187cb32ad9493bfe1f667cec8c9be4fc87c33`

## Outcome

Fix the education-route failure in which a two-month internship salary remains active for years, a later paid role has no same-month income, and the resulting cash gap is silently converted into personal debt.

A committed career period must always answer, with evidence and effective dates:

- which career or paid engagement is active;
- whether its compensation is `known`, `estimated`, or explicitly `unpaid`;
- when the previous income stops and the next income starts;
- how any negative cash balance is actually funded.

## Authority contract

The only write path is:

`proposal -> validation -> accepted career/financial events -> atomic transaction -> ledger -> derived state/report`

Narrative text, a previous salary, the wealth attribute, and report prose are not financial authority.

Every completed paid-career transition must resolve compensation in the same transaction:

1. `known`: an explicit accepted personal compensation amount;
2. `estimated`: no amount is stated, but the accepted role definition is sufficient for the compensation policy;
3. `unpaid`: the accepted narrative explicitly says the role is unpaid.

There is no `reuse_previous` resolution across different `CareerState` IDs. If none of the three resolutions is available, reject the candidate and leave age, history, career state, world state, ledger, and revisions unchanged.

## Role-based estimate

Add a deterministic, versioned compensation policy. The model extracts a grounded role profile; code chooses the range and settlement amount.

Minimum inputs:

- occupation family;
- career stage or seniority;
- employment type (`internship`, `part_time`, `full_time`, `self_employed`);
- industry and organization tier when supported by text;
- region when supported, otherwise an explicit `unknown` fallback;
- simulation calendar year.

The accepted estimate records its range, scalar settlement amount, policy ID/version, inputs, confidence, evidence, effective month, and review month. Use the policy median as the ledger amount so replay is deterministic. A broader fallback lowers confidence and widens the range; it must never copy the previous career's amount.

Explicit user compensation overrides the estimate. A model-generated exact amount that is a material outlier must be repaired or regenerated unless the narrative provides a grounded reason. Estimated income must be reviewed on promotion, job change, explicit pay change, or its configured review date.

## Lifecycle rules

- A bounded internship or temporary contract requires `activeUntilAgeInMonths`; “two months” cannot become an open-ended salary.
- Student education and paid engagement are separate semantics. An internship or part-time job does not by itself end student family support; support ends only on an accepted full exit from the student stage or an explicit support-end event.
- A paid career transition atomically ends or migrates the old career-linked income and starts the `known` or `estimated` replacement at the same effective month.
- Period settlement splits at every accepted event boundary. A period-end employment status cannot be applied retroactively to the full period.
- Completed personal freelance receipts create one-off or bounded contract income events. Company revenue or vague commercial traction does not become personal income.
- A negative cash balance without an accepted funding event becomes a blocking `UNRESOLVED_FUNDING_GAP`; it does not create `system_auto_shortfall` personal debt. Only an accepted debt draw with a source and terms creates debt.
- `FinancialState`, financial charts, debt health, and report prose are projections of the accepted ledger. The wealth score may consume ledger-derived liquidity, net-worth, income-stability, and debt-health signals, but cannot independently contradict them. Health scoring is outside this change.

## Acceptance criteria

For the known education regression:

- the remote-design receipt is recorded when the narrative says it was received;
- family support remains visible as funding while the protagonist is a student;
- the `0.3 万/月` internship income accrues for exactly two months;
- the internship does not end student status or family support;
- the later completed full-time role starts a new `known` or policy-`estimated` income in its effective month;
- no month silently uses the internship wage for a different career and no transition creates an uncovered income interval unless explicitly unpaid;
- no debt account is created without an accepted debt event;
- rejected candidates do not advance time or mutate any authoritative state;
- replay from the last trusted pre-divergence node derives the final balance again; no final-balance clamp or direct `52.6 -> 0` patch is allowed.

## Test plan

### 1. Focused unit tests during development

Add or extend:

- `careerCompensationPolicy.test.ts`: grounded role normalization, fallback hierarchy, deterministic median, version/provenance, outlier handling, and no previous-salary reuse;
- `reconcileCareerIncomeAtomicity.test.ts`: `known`/`estimated`/`unpaid` transition groups, same-month old/new income replacement, and total rollback of an incomplete group;
- `studentFundingPolicy.test.ts`: two-month internship duration, student status retained, family support retained, and explicit freelance receipt;
- `commitFinancialDomainTransaction.test.ts`: settlement before/after an event boundary and no period-end-state backdating;
- `reduceFinancialLedger.test.ts`: unresolved deficits fail closed and cannot create debt without an accepted debt event;
- `simulationService.test.ts` and `selectedPersonalIncomeProposal.test.ts`: completed role without an amount receives a policy estimate; an offer-only statement does not; model outliers repair/regenerate; rejected Preview leaves state unchanged;
- `financialState.test.ts` and final-financial-narrative tests: projections use the corrected ledger and cannot narrate unsupported debt.

Run focused files with `node --import tsx --test <files...>` after each implementation slice.

### 2. Deterministic regression route

Build one fixture that replays the failing sequence:

`student + family support -> freelance receipt -> two-month internship -> graduation/full-time role without explicit pay -> later role/pay review`

Assert every event boundary, active income interval, period income/expense total, support lifecycle, absence of automatic debt, deterministic replay, and narrative/ledger agreement. Do not assert that final debt must be zero; assert that every balance is derivable from accepted events.

### 3. Repository gate before commit

Run, in order:

1. `pnpm lint`
2. `pnpm test`
3. `pnpm build`
4. `git diff --check`

### 4. Behavioral validation without 2/2/1

Use deterministic event replay rather than a new model/browser run:

- replay the education sequence from student support through internship, graduation, full-time employment, and salary review;
- run a fixed role corpus plus deterministic generated cases across occupation, stage, employment type, region, industry, and organization tier;
- inject incomplete atomic transactions and unfunded deficits and assert total rollback/no debt creation;
- shadow-replay the existing 117-node artifact read-only and compare bounded-income overruns, paid-career gaps, automatic-shortfall debt, estimate coverage, and projected balance ranges.

This branch does not run a new 2/2/1 route. A fresh 2/2/1 remains release-candidate evidence and should be run only after shared-contract source parity is restored and the candidate is frozen.

## Implemented verification

- focused career-compensation suite: 117 passed;
- full repository suite: 969 passed, 0 failed;
- `pnpm lint`: passed;
- `pnpm build`: passed (the existing large-chunk advisory remains non-blocking);
- additional deterministic evidence: 5 month-boundary cases, 4 metamorphic role variants, 1 JSON checkpoint/continuation replay, and 6 fault-injection guards; the generated result is byte-for-byte reproducible;
- historical shadow replay: 117 nodes read, education baseline automatic shortfall `52.6 万`, projected corrected range `9.45–129.33 万` with median `69.39 万`;
- Web V4 compatibility: preserved expense lifecycle authority, pending-offer handling, and the rule that founder/company revenue cannot become personal owner draw without an accepted receipt.

## Non-goals

- Predicting an individual's exact real-world salary;
- hard-coding one salary for every occurrence of a job title;
- fixing health-score behavior;
- hiding, capping, or directly rewriting the existing `52.6 万` result;
- automatically migrating old saved histories in this first change.
