'use client';

import React from 'react';
import { RemoteCursor } from '@/lib/collaboration';

interface LiveCursorsProps {
  cursors: RemoteCursor[];
  /** Optional container ref; when omitted cursors are positioned against the viewport. */
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * Renders other users' cursors. Coordinates are normalized (0..1) so they map
 * correctly to the container regardless of scroll or viewport size.
 */
export function LiveCursors({ cursors, containerRef }: LiveCursorsProps) {
  if (cursors.length === 0) return null;

  const container = containerRef?.current;
  const rect = container?.getBoundingClientRect();
  const containerPosition =
    container && rect
      ? {
          position: 'absolute' as const,
          left: container.scrollLeft,
          top: container.scrollTop,
          width: rect.width,
          height: rect.height,
        }
      : null;

  return (
    <div
      className={`pointer-events-none z-30 overflow-hidden ${
        containerPosition ? 'absolute inset-0' : 'fixed inset-0'
      }`}
      aria-hidden
      data-testid="live-cursors"
    >
      {cursors.map((cursor) => {
        const style: React.CSSProperties = containerPosition
          ? {
              left: `${cursor.x * 100}%`,
              top: `${cursor.y * 100}%`,
            }
          : { left: `${cursor.x * 100}vw`, top: `${cursor.y * 100}vh` };

        return (
          <div
            key={cursor.userId}
            className="absolute transition-transform duration-75 ease-out"
            style={{ ...style, transform: 'translate(-2px, -2px)' }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill={cursor.color}
              stroke="white"
              strokeWidth="1.5"
            >
              <path d="M4 2l16 8-7 1.5L10 20z" />
            </svg>
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap shadow"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default LiveCursors;
