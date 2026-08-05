# Release evidence approvals

This directory contains only small approval manifests produced by:

```bash
pnpm release:verify -- --root "<external-evidence-root>" \
  --approval-out "release/evidence/<candidate-id>.json"
```

Full real-browser JSON, checkpoints, reports, and images must remain outside the Git worktree. An approval is valid only while the deployment revision has the same runtime fingerprint as the certified candidate.
