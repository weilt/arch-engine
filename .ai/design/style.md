# APT Reference Design System

Light B2B admin UI for APT dogfood and integration tests.

## Constraints

- Use semantic tokens from `tokens.css`; never hard-code hex in components.
- Primary actions use `PrimaryButton`; secondary/cancel use `SecondaryButton`.
- Page chrome: `PageHeader` at top; content in `Card` surfaces.
- List pages: toolbar + table area; empty → `EmptyState`, loading → `SkeletonList`.
- Form pages: labeled `Input` fields; validation errors → `Alert` (error variant).
- Spacing rhythm: `--spacingMd` between blocks, `--spacingLg` between sections.
- Border radius: `--radiusMd` for cards and inputs, `--radiusSm` for buttons.
