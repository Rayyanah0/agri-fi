/**
 * Kanban board state model (#1237).
 * Pure reducer so it can be unit-tested and persisted independently of the UI.
 */

export type CardType = 'deal' | 'task' | 'milestone';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}

export interface KanbanComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  type: CardType;
  columnId: string;
  priority: Priority;
  assignee?: string;
  dealId?: string;
  labelIds: string[];
  dueDate?: string;
  comments: KanbanComment[];
  createdAt: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  wipLimit?: number;
}

export interface BoardState {
  columns: KanbanColumn[];
  labels: KanbanLabel[];
  cards: KanbanCard[];
  compact: boolean;
}

export interface CardFilters {
  assignee?: string;
  priority?: Priority;
  dealId?: string;
  labelId?: string;
  search?: string;
}

export const DEFAULT_BOARD: BoardState = {
  columns: [
    { id: 'new', title: 'New' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'review', title: 'Review' },
    { id: 'completed', title: 'Completed' },
  ],
  labels: [
    { id: 'compliance', name: 'Compliance', color: '#ef4444' },
    { id: 'logistics', name: 'Logistics', color: '#3b82f6' },
    { id: 'finance', name: 'Finance', color: '#22c55e' },
    { id: 'docs', name: 'Documents', color: '#a855f7' },
  ],
  cards: [],
  compact: false,
};

export type BoardAction =
  | { type: 'load'; state: BoardState }
  | { type: 'addCard'; card: Omit<KanbanCard, 'id' | 'createdAt' | 'comments'> }
  | { type: 'updateCard'; id: string; patch: Partial<KanbanCard> }
  | { type: 'deleteCard'; id: string }
  | { type: 'moveCard'; id: string; columnId: string; beforeId?: string }
  | { type: 'addComment'; cardId: string; author: string; body: string }
  | { type: 'addColumn'; title: string }
  | { type: 'renameColumn'; id: string; title: string }
  | { type: 'removeColumn'; id: string }
  | { type: 'addLabel'; name: string; color: string }
  | { type: 'removeLabel'; id: string }
  | { type: 'toggleCompact' };

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_') || uid();

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'load':
      return action.state;
    case 'addCard':
      return {
        ...state,
        cards: [
          ...state.cards,
          { ...action.card, id: uid(), createdAt: new Date().toISOString(), comments: [] },
        ],
      };
    case 'updateCard':
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };
    case 'deleteCard':
      return { ...state, cards: state.cards.filter((c) => c.id !== action.id) };
    case 'moveCard': {
      const card = state.cards.find((c) => c.id === action.id);
      if (!card || action.id === action.beforeId) return state;
      const rest = state.cards.filter((c) => c.id !== action.id);
      const moved = { ...card, columnId: action.columnId };
      const idx = action.beforeId ? rest.findIndex((c) => c.id === action.beforeId) : -1;
      if (idx === -1) rest.push(moved);
      else rest.splice(idx, 0, moved);
      return { ...state, cards: rest };
    }
    case 'addComment':
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.cardId
            ? {
                ...c,
                comments: [
                  ...c.comments,
                  { id: uid(), author: action.author, body: action.body, createdAt: new Date().toISOString() },
                ],
              }
            : c,
        ),
      };
    case 'addColumn': {
      let id = slug(action.title);
      if (state.columns.some((c) => c.id === id)) id = `${id}_${uid().slice(0, 4)}`;
      return { ...state, columns: [...state.columns, { id, title: action.title }] };
    }
    case 'renameColumn':
      return {
        ...state,
        columns: state.columns.map((c) => (c.id === action.id ? { ...c, title: action.title } : c)),
      };
    case 'removeColumn': {
      if (state.columns.length <= 1) return state;
      const columns = state.columns.filter((c) => c.id !== action.id);
      // Cards in a removed column fall back to the first remaining column.
      return {
        ...state,
        columns,
        cards: state.cards.map((c) => (c.columnId === action.id ? { ...c, columnId: columns[0].id } : c)),
      };
    }
    case 'addLabel':
      return { ...state, labels: [...state.labels, { id: uid(), name: action.name, color: action.color }] };
    case 'removeLabel':
      return {
        ...state,
        labels: state.labels.filter((l) => l.id !== action.id),
        cards: state.cards.map((c) => ({ ...c, labelIds: c.labelIds.filter((l) => l !== action.id) })),
      };
    case 'toggleCompact':
      return { ...state, compact: !state.compact };
    default:
      return state;
  }
}

export function filterCards(cards: KanbanCard[], f: CardFilters): KanbanCard[] {
  const q = f.search?.toLowerCase().trim();
  return cards.filter(
    (c) =>
      (!f.assignee || c.assignee === f.assignee) &&
      (!f.priority || c.priority === f.priority) &&
      (!f.dealId || c.dealId === f.dealId) &&
      (!f.labelId || c.labelIds.includes(f.labelId)) &&
      (!q || c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)),
  );
}

export type DueStatus = 'overdue' | 'due_soon' | 'on_track' | 'none';

export function getDueStatus(card: KanbanCard, completedColumnId = 'completed', now = Date.now()): DueStatus {
  if (!card.dueDate || card.columnId === completedColumnId) return 'none';
  const diff = new Date(card.dueDate).getTime() - now;
  if (diff < 0) return 'overdue';
  if (diff < 2 * 24 * 60 * 60 * 1000) return 'due_soon';
  return 'on_track';
}

const STORAGE_KEY = 'agri-fi:kanban-board';

export function loadBoard(): BoardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_BOARD, ...JSON.parse(raw) } : DEFAULT_BOARD;
  } catch {
    return DEFAULT_BOARD;
  }
}

export function saveBoard(state: BoardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — board stays in memory */
  }
}
