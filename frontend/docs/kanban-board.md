# Kanban Board

Route: `/dashboard/kanban` (linked as **Board** in the dashboard sidebar for farmers, traders, investors and admins).

## Files

| File | Purpose |
|---|---|
| `src/lib/kanban/board.ts` | Types, pure `boardReducer`, `filterCards`, `getDueStatus`, persistence |
| `src/components/kanban/KanbanBoard.tsx` | Board UI, card form, details dialog, board settings |
| `src/app/[locale]/dashboard/kanban/page.tsx` | Authenticated page wrapper |

## Features

- **Columns** – default `New → In Progress → Review → Completed`. Column header shows card count (and WIP limit if set).
- **Card creation** – `+` on a column; cards are `task`, `deal` or `milestone`, with priority, due date, labels and an optional linked deal (from `getTraderDeals` / `getFarmerDeals`). The creator is the default assignee.
- **Drag-and-drop** – native HTML5 DnD (no extra dependency). Drop on a column to append, or on a card to insert before it. Keyboard users can change status from the details dialog.
- **Card details** – click (or Enter) opens a dialog to edit title, status, priority, assignee, due date, deal, labels and description, add comments, or delete the card.
- **Filtering** – search, assignee, priority, deal and label.
- **Labels** – colour-coded; manage in *Customize board*.
- **Comments** – timestamped, authored by the signed-in user.
- **Due dates** – overdue cards are red, cards due within 48 h orange; cards in the last column are treated as done.
- **Customization** – add/rename/remove columns (cards in a removed column move to the first column), add/remove labels, compact vs detailed view.

## Persistence

Board state is saved to `localStorage` (`agri-fi:kanban-board`). Because state changes go through `boardReducer`, swapping in a backend tasks API only requires replacing `loadBoard`/`saveBoard`.
