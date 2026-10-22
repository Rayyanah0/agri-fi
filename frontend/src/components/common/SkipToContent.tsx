import React from 'react';

export interface SkipToContentProps {
  contentId?: string;
  label?: string;
}

/**
 * Accessible SkipToContent component ensuring WCAG 2.1 AA keyboard navigation compliance (#1134).
 */
export const SkipToContent: React.FC<SkipToContentProps> = ({
  contentId = 'main-content',
  label = 'Skip to main content',
}) => {
  return (
    <a
      href={`#${contentId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded focus:outline-none focus:ring-2 focus:ring-white"
    >
      {label}
    </a>
  );
};

export default SkipToContent;
