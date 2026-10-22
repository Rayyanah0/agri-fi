'use client';

import type { CallManager, CallState } from '@/lib/calling/call-manager';

export default function IncomingCallModal({ manager, state }: { manager: CallManager; state: CallState }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Incoming call" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-green-100 text-2xl">
          {state.media === 'video' ? '📹' : '📞'}
        </div>
        <p className="text-sm text-slate-500">Incoming {state.media} call</p>
        <p className="text-lg font-semibold">{state.peer?.name}</p>
        {state.peer?.role && <p className="text-xs capitalize text-slate-500">{state.peer.role}</p>}
        {state.dealId && <p className="mt-1 text-xs text-slate-500">Deal #{state.dealId.slice(0, 8)}</p>}
        <div className="mt-6 flex justify-center gap-4">
          <button onClick={() => manager.decline()} className="rounded-full bg-red-600 px-5 py-2 text-white">Decline</button>
          <button onClick={() => manager.accept()} className="rounded-full bg-green-600 px-5 py-2 text-white">Accept</button>
        </div>
      </div>
    </div>
  );
}
