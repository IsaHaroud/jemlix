# Admin dashboard code map

`public/admin.js` starts the dashboard, attaches navigation and shared UI events, and refreshes the views after a change. The page remains `public/admin.html`.

| Module | Owns |
| --- | --- |
| `public/admin/shared.js` | API requests, formatting, image thumbnails, modal and drawer controls, navigation |
| `public/admin/catalog.js` | Review queue, channel URLs, product list, product editor, publishing |
| `public/admin/suppliers.js` | Supplier list and details, activation, subscriptions, payments |
| `public/admin/submissions.js` | Submission list, review actions, manual submissions |
| `public/admin/overview.js` | Summary cards, items needing attention, payment history |

Each feature module keeps its own state and registers its own event handlers through `init()`. `admin.js` connects the modules and provides `refreshAll()` for actions that affect several views. Shared admin styles are in `public/styles.css`; the supplier detail workspace has scoped styles in `public/admin/supplier-detail.css`.
