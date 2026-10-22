'use client';

import { useEffect, useMemo, useReducer, useState, type DragEvent } from 'react';
import { apiClient, type Deal } from '@/lib/api';
import {
  boardReducer,
  DEFAULT_BOARD,
  filterCards,
  getDueStatus,
  loadBoard,
  saveBoard,
  type CardFilters,
  type CardType,
  type KanbanCard,
  type Priority,
} from '@/lib/kanban/board';

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};
const DUE_STYLES = {
  overdue: 'text-red-600 font-semibold',
  due_soon: 'text-orange-600',
  on_track: 'text-gray-500',
  none: 'text-gray-400',
};

export default function KanbanBoard() {
  const [state, dispatch] = useReducer(boardReducer, DEFAULT_BOARD);
  const [hydrated, setHydrated] = useState(false);
  const [filters, setFilters] = useState<CardFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const currentUser = apiClient.getCurrentUser();
  const me = currentUser?.name ?? currentUser?.email ?? 'Me';

  useEffect(() => {
    dispatch({ type: 'load', state: loadBoard() });
    setHydrated(true);
    const loader = currentUser?.role === 'farmer' ? apiClient.getFarmerDeals : apiClient.getTraderDeals;
    loader.call(apiClient).then(setDeals).catch(() => setDeals([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrated) saveBoard(state);
  }, [state, hydrated]);

  const visible = useMemo(() => filterCards(state.cards, filters), [state.cards, filters]);
  const assignees = useMemo(
    () => Array.from(new Set(state.cards.map((c) => c.assignee).filter(Boolean))) as string[],
    [state.cards],
  );
  const selected = state.cards.find((c) => c.id === selectedId) ?? null;
  const completedId = state.columns[state.columns.length - 1]?.id;

  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: DragEvent, columnId: string, beforeId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/plain');
    if (id) dispatch({ type: 'moveCard', id, columnId, beforeId });
    setDragOver(null);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar / filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search cards"
          placeholder="Search…"
          className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          value={filters.search ?? ''}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select
          aria-label="Filter by assignee"
          className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          value={filters.assignee ?? ''}
          onChange={(e) => setFilters({ ...filters, assignee: e.target.value || undefined })}
        >
          <option value="">All assignees</option>
          {assignees.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          value={filters.priority ?? ''}
          onChange={(e) => setFilters({ ...filters, priority: (e.target.value || undefined) as Priority })}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Filter by deal"
          className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          value={filters.dealId ?? ''}
          onChange={(e) => setFilters({ ...filters, dealId: e.target.value || undefined })}
        >
          <option value="">All deals</option>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title ?? d.commodity}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by label"
          className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          value={filters.labelId ?? ''}
          onChange={(e) => setFilters({ ...filters, labelId: e.target.value || undefined })}
        >
          <option value="">All labels</option>
          {state.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="rounded border px-2 py-1 text-sm" onClick={() => setFilters({})}>
          Clear
        </button>
        <div className="ml-auto flex gap-2">
          <button className="rounded border px-2 py-1 text-sm" onClick={() => dispatch({ type: 'toggleCompact' })}>
            {state.compact ? 'Detailed view' : 'Compact view'}
          </button>
          <button className="rounded border px-2 py-1 text-sm" onClick={() => setShowSettings((s) => !s)}>
            Customize board
          </button>
        </div>
      </div>

      {showSettings && <BoardSettings state={state} dispatch={dispatch} />}

      {/* Columns */}
      <div className="flex gap-4 overflow-x-auto pb-4" role="list" aria-label="Kanban board">
        {state.columns.map((col) => {
          const cards = visible.filter((c) => c.columnId === col.id);
          const total = state.cards.filter((c) => c.columnId === col.id).length;
          const overLimit = col.wipLimit !== undefined && total > col.wipLimit;
          return (
            <section
              key={col.id}
              role="listitem"
              aria-label={`${col.title} column`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, col.id)}
              className={`flex w-72 shrink-0 flex-col rounded-lg bg-gray-50 p-3 dark:bg-gray-900 ${
                dragOver === col.id ? 'ring-2 ring-green-500' : ''
              }`}
            >
              <header className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">
                  {col.title}{' '}
                  <span className={`text-xs ${overLimit ? 'text-red-600' : 'text-gray-500'}`}>
                    {total}
                    {col.wipLimit !== undefined ? `/${col.wipLimit}` : ''}
                  </span>
                </h2>
                <button
                  aria-label={`Add card to ${col.title}`}
                  className="rounded px-2 text-lg leading-none hover:bg-gray-200 dark:hover:bg-gray-700"
                  onClick={() => setCreatingIn(col.id)}
                >
                  +
                </button>
              </header>

              {creatingIn === col.id && (
                <NewCardForm
                  deals={deals}
                  labels={state.labels}
                  defaultAssignee={me}
                  onCancel={() => setCreatingIn(null)}
                  onCreate={(card) => {
                    dispatch({ type: 'addCard', card: { ...card, columnId: col.id } });
                    setCreatingIn(null);
                  }}
                />
              )}

              <ul className="flex min-h-[4rem] flex-col gap-2">
                {cards.map((card) => (
                  <li
                    key={card.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, card.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, col.id, card.id)}
                    onClick={() => setSelectedId(card.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedId(card.id)}
                    tabIndex={0}
                    className="cursor-grab rounded border bg-white p-2 shadow-sm hover:shadow dark:border-gray-700 dark:bg-gray-800"
                  >
                    <CardSummary card={card} state={state} compact={state.compact} completedId={completedId} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {selected && (
        <CardDetails
          card={selected}
          state={state}
          deals={deals}
          me={me}
          dispatch={dispatch}
          completedId={completedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

type Dispatch = React.Dispatch<Parameters<typeof boardReducer>[1]>;
type State = ReturnType<typeof loadBoard>;

function CardSummary({ card, state, compact, completedId }: { card: KanbanCard; state: State; compact: boolean; completedId?: string }) {
  const due = getDueStatus(card, completedId);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap gap-1">
        {card.labelIds.map((id) => {
          const l = state.labels.find((x) => x.id === id);
          return l ? (
            <span key={id} className="rounded px-1.5 text-[10px] text-white" style={{ backgroundColor: l.color }}>
              {l.name}
            </span>
          ) : null;
        })}
      </div>
      <p className="font-medium">{card.title}</p>
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="uppercase text-gray-500">{card.type}</span>
          <span className={`rounded px-1.5 ${PRIORITY_STYLES[card.priority]}`}>{card.priority}</span>
          {card.assignee && <span className="text-gray-600 dark:text-gray-300">@{card.assignee}</span>}
          {card.dueDate && (
            <span className={DUE_STYLES[due]}>
              {due === 'overdue' ? 'Overdue · ' : ''}
              {new Date(card.dueDate).toLocaleDateString()}
            </span>
          )}
          {card.comments.length > 0 && <span className="text-gray-500">💬 {card.comments.length}</span>}
        </div>
      )}
    </div>
  );
}

interface NewCardInput {
  title: string;
  type: CardType;
  priority: Priority;
  assignee?: string;
  dealId?: string;
  dueDate?: string;
  labelIds: string[];
  description?: string;
  columnId: string;
}

function NewCardForm({
  deals,
  labels,
  defaultAssignee,
  onCreate,
  onCancel,
}: {
  deals: Deal[];
  labels: State['labels'];
  defaultAssignee: string;
  onCreate: (c: NewCardInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CardType>('task');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dealId, setDealId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);

  return (
    <form
      className="mb-2 space-y-2 rounded border bg-white p-2 text-sm dark:bg-gray-800"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onCreate({
          title: title.trim(),
          type,
          priority,
          assignee: defaultAssignee,
          dealId: dealId || undefined,
          dueDate: dueDate || undefined,
          labelIds,
          columnId: '',
        });
      }}
    >
      <input autoFocus aria-label="Card title" placeholder="Title" className="w-full rounded border px-2 py-1 dark:bg-gray-900" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex gap-1">
        <select aria-label="Card type" className="flex-1 rounded border dark:bg-gray-900" value={type} onChange={(e) => setType(e.target.value as CardType)}>
          <option value="task">Task</option>
          <option value="deal">Deal</option>
          <option value="milestone">Milestone</option>
        </select>
        <select aria-label="Priority" className="flex-1 rounded border dark:bg-gray-900" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <select aria-label="Linked deal" className="w-full rounded border dark:bg-gray-900" value={dealId} onChange={(e) => setDealId(e.target.value)}>
        <option value="">No linked deal</option>
        {deals.map((d) => (
          <option key={d.id} value={d.id}>{d.title ?? d.commodity}</option>
        ))}
      </select>
      <input type="date" aria-label="Due date" className="w-full rounded border px-2 dark:bg-gray-900" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <LabelPicker labels={labels} value={labelIds} onChange={setLabelIds} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-2">Cancel</button>
        <button type="submit" className="rounded bg-green-600 px-3 py-1 text-white">Add</button>
      </div>
    </form>
  );
}

function LabelPicker({ labels, value, onChange }: { labels: State['labels']; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            type="button"
            key={l.id}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={`rounded px-1.5 text-xs ${on ? 'text-white' : 'opacity-60'}`}
            style={{ backgroundColor: on ? l.color : 'transparent', border: `1px solid ${l.color}` }}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function CardDetails({
  card,
  state,
  deals,
  me,
  dispatch,
  completedId,
  onClose,
}: {
  card: KanbanCard;
  state: State;
  deals: Deal[];
  me: string;
  dispatch: Dispatch;
  completedId?: string;
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const update = (patch: Partial<KanbanCard>) => dispatch({ type: 'updateCard', id: card.id, patch });
  const due = getDueStatus(card, completedId);

  return (
    <div role="dialog" aria-modal="true" aria-label="Card details" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <input aria-label="Title" className="w-full bg-transparent text-lg font-semibold" value={card.title} onChange={(e) => update({ title: e.target.value })} />
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col">Status
            <select className="rounded border dark:bg-gray-800" value={card.columnId} onChange={(e) => dispatch({ type: 'moveCard', id: card.id, columnId: e.target.value })}>
              {state.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="flex flex-col">Priority
            <select className="rounded border dark:bg-gray-800" value={card.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col">Assignee
            <input className="rounded border px-1 dark:bg-gray-800" value={card.assignee ?? ''} onChange={(e) => update({ assignee: e.target.value || undefined })} />
          </label>
          <label className="flex flex-col">Due date
            <input type="date" className={`rounded border px-1 dark:bg-gray-800 ${DUE_STYLES[due]}`} value={card.dueDate?.slice(0, 10) ?? ''} onChange={(e) => update({ dueDate: e.target.value || undefined })} />
          </label>
          <label className="col-span-2 flex flex-col">Linked deal
            <select className="rounded border dark:bg-gray-800" value={card.dealId ?? ''} onChange={(e) => update({ dealId: e.target.value || undefined })}>
              <option value="">None</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.title ?? d.commodity}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3"><LabelPicker labels={state.labels} value={card.labelIds} onChange={(labelIds) => update({ labelIds })} /></div>
        <textarea aria-label="Description" placeholder="Description" rows={3} className="mt-3 w-full rounded border p-2 text-sm dark:bg-gray-800" value={card.description ?? ''} onChange={(e) => update({ description: e.target.value })} />

        <h3 className="mt-4 font-semibold">Comments</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {card.comments.map((c) => (
            <li key={c.id} className="rounded bg-gray-50 p-2 dark:bg-gray-800">
              <span className="font-medium">{c.author}</span>{' '}
              <span className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleString()}</span>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!comment.trim()) return; dispatch({ type: 'addComment', cardId: card.id, author: me, body: comment.trim() }); setComment(''); }}>
          <input aria-label="New comment" placeholder="Add a comment…" className="flex-1 rounded border px-2 py-1 text-sm dark:bg-gray-800" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button type="submit" className="rounded bg-green-600 px-3 text-sm text-white">Post</button>
        </form>

        <div className="mt-4 flex justify-end">
          <button className="text-sm text-red-600" onClick={() => { dispatch({ type: 'deleteCard', id: card.id }); onClose(); }}>Delete card</button>
        </div>
      </div>
    </div>
  );
}

function BoardSettings({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const [colTitle, setColTitle] = useState('');
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('#f59e0b');
  return (
    <div className="grid gap-4 rounded border p-3 text-sm md:grid-cols-2">
      <div>
        <h3 className="mb-2 font-semibold">Columns</h3>
        {state.columns.map((c) => (
          <div key={c.id} className="mb-1 flex gap-1">
            <input aria-label="Column title" className="flex-1 rounded border px-1 dark:bg-gray-800" value={c.title} onChange={(e) => dispatch({ type: 'renameColumn', id: c.id, title: e.target.value })} />
            <button aria-label={`Remove ${c.title}`} onClick={() => dispatch({ type: 'removeColumn', id: c.id })}>✕</button>
          </div>
        ))}
        <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (colTitle.trim()) dispatch({ type: 'addColumn', title: colTitle.trim() }); setColTitle(''); }}>
          <input placeholder="New column" className="flex-1 rounded border px-1 dark:bg-gray-800" value={colTitle} onChange={(e) => setColTitle(e.target.value)} />
          <button type="submit" className="rounded border px-2">Add</button>
        </form>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Labels</h3>
        {state.labels.map((l) => (
          <div key={l.id} className="mb-1 flex items-center gap-2">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: l.color }} />
            <span className="flex-1">{l.name}</span>
            <button aria-label={`Remove ${l.name}`} onClick={() => dispatch({ type: 'removeLabel', id: l.id })}>✕</button>
          </div>
        ))}
        <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (labelName.trim()) dispatch({ type: 'addLabel', name: labelName.trim(), color: labelColor }); setLabelName(''); }}>
          <input placeholder="New label" className="flex-1 rounded border px-1 dark:bg-gray-800" value={labelName} onChange={(e) => setLabelName(e.target.value)} />
          <input type="color" aria-label="Label color" value={labelColor} onChange={(e) => setLabelColor(e.target.value)} />
          <button type="submit" className="rounded border px-2">Add</button>
        </form>
      </div>
    </div>
  );
}
