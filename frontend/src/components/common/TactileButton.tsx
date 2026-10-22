'use client';

import React from 'react';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import { HapticPatternType } from '../../lib/haptic/hapticFeedback';

export interface TactileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  hapticPattern?: HapticPatternType;
  tactileVariant?: 'raised' | 'flat' | 'indented';
}

export const TactileButton: React.FC<TactileButtonProps> = ({
  children,
  onClick,
  hapticPattern = 'light',
  tactileVariant = 'raised',
  className = '',
  disabled,
  ...props
}) => {
  const { trigger } = useHapticFeedback();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      trigger(hapticPattern);
    }
    if (onClick) {
      onClick(e);
    }
  };

  const variantStyles = {
    raised: 'shadow-md active:shadow-sm active:translate-y-0.5 transition-all',
    flat: 'border border-gray-300 dark:border-gray-700 active:bg-gray-100 dark:active:bg-gray-800',
    indented: 'shadow-inner bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800',
  };

  return (
    <button
      {...props}
      disabled={disabled}
      onClick={handleClick}
      className={`px-4 py-2 rounded-lg font-medium select-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[tactileVariant]} ${className}`}
    >
      {children}
    </button>
  );
};
