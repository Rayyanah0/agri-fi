# Component Library & Accessibility Guidelines (WCAG 2.1 AA)

## Accessibility Standards
All frontend components must comply with WCAG 2.1 Level AA requirements to guarantee universal access for farmers, traders, and investors.

### Key Rules
1. **Keyboard Accessibility**: Every interactive element must be reachable and operable via keyboard alone (`Tab`, `Enter`, `Space`, `Escape`).
2. **Visible Focus**: Never suppress `:focus` or `focus-visible` without providing high-contrast replacement styling (`outline: 2px solid #2563eb`).
3. **Color Contrast**:
   - Body text against background: minimum ratio **4.5:1**.
   - Large text (>=18pt or bold >=14pt): minimum ratio **3:1**.
   - Essential graphical objects and UI components: minimum ratio **3:1**.
4. **ARIA Roles & Labels**:
   - Modals must include `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
   - Dynamic updates must utilize `aria-live="polite"` or `aria-live="assertive"`.
   - Icon-only buttons must specify `aria-label`.
5. **Skip-to-Content**: Every top-level page layout must render a skip link as the very first tabbable element.
