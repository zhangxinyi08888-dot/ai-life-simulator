# Expense Estimation Policy V2 calibration memo

Status: release calibration record for `expense-estimation-policy-v2` version 2
Approved: 2026-08-03
Approval scope: policy-level configuration

## Purpose and guardrails

This memo documents the initial calibration behind the versioned policy in
`src/domain/finance/expenseEstimationPolicyV2.ts`. It is a bounded fallback
for a responsibility that is already authoritative while its personal amount
is still unknown. It is not a consumer-price index, an affordability model,
or a target-savings-rate control.

- An explicit personal amount, an explicit shared total multiplied by the
  protagonist share, and an existing accepted responsibility all outrank this
  policy.
- The policy never reads income, cash, net worth, or a desired savings rate.
- An unknown city resolves to the medium-cost band, never to the low band.
- A policy estimate records `needs_review`; it cannot impersonate a confirmed
  amount. A lower policy value cannot silently reduce a higher accepted or
  legacy value.
- Age does not invent healthcare, elder-care, housing, or any other account.
  It calibrates an account only after its responsibility is accepted.
- `elder_care` may select the elevated row only from a new, completed,
  protagonist-owned continuing care escalation on the same active
  `needs_review + contextual_estimate` parent-care account. It cannot create
  an account, replace a known amount, lower an amount, change the beneficiary
  or scope, or reuse the same old evidence after an age-band transition.

## Input basis

The base values are monthly protagonist-side commitments in `wan` for a
medium-cost Chinese city. The policy deliberately separates the recurring
responsibility types that were previously collapsed into a single 0.35-wan
basic-living estimate. Plausible ranges describe review and sensitivity
bounds; the ledger always accrues the base estimate, not the low end of a
range.

| Responsibility | Medium base (wan/month) | Plausible range | Calibration rationale |
|---|---:|---:|---|
| Student basic living | 0.20 | 0.12–0.35 | Personal daily cost after accepted family/school support; not an employed-adult substitute. |
| Adult basic living | 0.35 | 0.35–0.60 | Non-housing food, utilities, local transport and ordinary daily needs; this is the only minimum protection line. |
| Primary residence | 0.35 | 0.20–0.70 | Personal share of basic housing service; excludes mortgage principal and interest. |
| Child support | 0.25 | 0.15–0.60 | One accepted child for whom the protagonist bears continuing support. |
| Elder care, baseline | 0.20 | 0.10–0.60 | Accepted parent living support or non-medical care paid by the protagonist. |
| Elder care, elevated young/adult | 0.25 | 0.15–0.70 | Same accepted parent-care responsibility after new continuing intensity evidence; not selected from age alone. |
| Elder care, elevated older adult | 0.35 | 0.25–0.90 | Same accepted responsibility after new continuing intensity evidence at older age; not selected from age or repeated prose alone. |
| Recurring healthcare, non-old age | 0.12 | 0.08–0.50 | Accepted ongoing medicine, follow-up or treatment. |
| Recurring healthcare, older adult | 0.24 | 0.16–0.80 | Same accepted ongoing obligation at older age; no account is created from age alone. |
| Personal insurance | 0.08 | 0.04–0.20 | Accepted ongoing personal commercial insurance premium. |
| Continuing education | 0.20 | 0.10–0.50 | Accepted education programme personally funded by the protagonist. |
| Legacy aggregate | 0.35 | 0.35–0.60 | Only for a legacy aggregate fact that cannot safely be decomposed into the responsibility types above. |

## Cost-band sensitivity

The policy applies a fixed contextual multiplier: low `0.9`, medium `1.0`,
and high `1.2`. This is a calibration sensitivity, not a source of authority.
The three representative bundles below show the resulting monthly committed
outflow when all listed responsibilities are already accepted and their exact
amounts are unknown.

| Exemplar | Accepted responsibilities | Low | Medium | High |
|---|---|---:|---:|---:|
| Independent employed adult | adult basic living + primary residence | 0.63 | 0.70 | 0.84 |
| Parent also supporting an elder | adult basic living + primary residence + one child + elder care | 1.04 | 1.15 | 1.38 |
| Older adult with escalated parent care | adult basic living + primary residence + elevated elder care | 0.95 | 1.05 | 1.26 |
| Older adult in continuing treatment | adult basic living + primary residence + ongoing healthcare | 0.85 | 0.94 | 1.13 |

Values are `wan/month`, rounded to two decimals. A verified `with_family` or
`provided` housing arrangement can legitimately have a zero personal housing
share, but only with accepted structural evidence; a missing rent sentence is
not that evidence.

The elevated elder-care rows are not a periodic inflation mechanism. The
reconciler and a dedicated validator require all of the following: the exact
parent account (or canonical `parents` aggregate) is already active, personal,
contextual and `needs_review`; the new evidence records a completed recurring
care escalation; and the selected policy amount is strictly greater than the
current amount. The permitted mutation changes only the amount, policy review
metadata and evidence. A one-off treatment, a parent illness without the
protagonist's recurring action, a shared/third-party responsibility, an
unrelated `care_plan`, age alone, or repeated old evidence is not eligible.

## Release and review decision

This V2 policy is accepted as a transparent initial estimator because it
prevents the prior one-way error: replacing a real or higher estimated
commitment with 0.35-wan adult basic living. It must be reviewed using:

1. independent fresh-route responsibility annotations, including both
   false-positive scope errors and missed accepted responsibilities;
2. responsibility-level review outcomes and `needs_review` closures; and
3. the above low/base/high sensitivity table, not an imposed savings-rate
   target.

Any later amount-table revision must increment the policy version, retain the
prior estimate on existing commitments until an Accepted change or review, and
publish a replacement memo with the same input and sensitivity sections.
