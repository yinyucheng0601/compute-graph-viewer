# Preview Gate

Use this workflow whenever the existing PTO system cannot satisfy a new module need.

## Required preview contents

Every preview must show:

1. Existing closest system pattern
2. Proposed new pattern
3. State coverage when relevant:
   - normal
   - hover
   - active
   - selected
4. Token usage
5. Why the current system is insufficient

## Output locations

Preferred order:

1. `/Users/yin/pto/<module>/component-preview.html`
2. `/Users/yin/pto/design-system-preview.html` when the pattern should become shared system UI

## Approval rule

- No explicit user approval: preview only
- Explicit user approval: first absorb into system, then consume from the module

## What counts as explicit approval

Examples:

- “可以，就用这个”
- “approve”
- “按这个迁移”

Examples that are not approval:

- “先看看”
- “接近了”
- “再调一调”
