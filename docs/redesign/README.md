# ATM redesign: plan documents

This folder holds the plan for redesigning ATM (AutomationTestManager). Read the files in this order:

| # | Document | What it answers |
|---|---|---|
| 1 | [01-overview.md](01-overview.md) | Why we redesign, who uses ATM, what the product should do, and the decisions already made |
| 2 | [02-current-architecture.md](02-current-architecture.md) | How the application works today: facts measured in the code |
| 3 | [03-target-architecture.md](03-target-architecture.md) | How the application will be built: modules, data, integrations, diagrams |
| 4 | [04-roles-and-permissions.md](04-roles-and-permissions.md) | The six roles, the `project_base` / `shared` tags, and who may do what |
| 5 | [05-design.md](05-design.md) | The new look and the interaction design: navigation, screens, components |
| 6 | [06-implementation-plan.md](06-implementation-plan.md) | The phases, their branches, what each delivers and how it is tested |
| 7 | [07-delivery-workflow.md](07-delivery-workflow.md) | How each phase is built, tested with UI tests, and delivered as a PR |
| 8 | [08-review-updates-plan.md](08-review-updates-plan.md) | Phases 15–22: the changes asked for in the review of the decisions |

The plan is a living document. When a phase changes the plan, it updates these files in the same PR.

Topics we agreed to discuss later are listed in [01-overview.md › Open topics](01-overview.md#open-topics).

Judgement calls made while implementing, to review together after phase 14, are listed in
[decisions-to-review.md](decisions-to-review.md).
