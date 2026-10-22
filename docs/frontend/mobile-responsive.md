# Mobile-Responsive Design & Touch-Optimized Interactions

## 1. Overview
The Agri-Fi frontend is optimized for low-bandwidth, touch-first mobile usage in field environments where farmers, cooperatives, and traveling commodity traders interact via smartphones.

---

## 2. Breakpoint Architecture

| Breakpoint | Target Screen Width | Layout Paradigm | Navigation Mode |
|---|---|---|---|
| **Mobile** | `< 640px` (`sm`) | Single-column fluid stack, bottom-sheet modals | Fixed bottom tab bar (`MobileBottomNav`) |
| **Tablet** | `640px` – `1024px` (`md`) | 2-column responsive grid | Collapsible drawer + condensed header |
| **Desktop** | `> 1024px` (`lg`) | Multi-column layout with sidebar | Persistent sidebar navigation |

---

## 3. Touch Optimization & Ergonomics

1. **Tap Targets**: All buttons, links, and form inputs enforce a minimum interactive boundary of **`44 × 44px`** (exceeding WCAG 2.1 AAA target size).
2. **Bottom Navigation Bar (`MobileBottomNav`)**:
   - Fixed to the bottom of the viewport with iOS safe area inset padding (`pb-[env(safe-area-inset-bottom)]`).
   - 5 Touch tabs: Home, Deals, Prominent Quick Action Center Button (`+`), Market Prices, and Profile.
3. **Pull-to-Refresh (`MobilePullToRefresh`)**:
   - Native drag-down gesture listener allowing one-handed refresh of market and deal feeds.
4. **Haptic Feedback**:
   - Tactile vibration responses (`navigator.vibrate`) for deal creation, investment confirmation, and tab switching.

---

## 4. Field Workflows

### 1. Quick Deal Creation Modal (`MobileQuickDealModal`)
- Rapid entry for crops, quantities, and asking prices.
- **Direct Camera Capture**: Integrated `<input type="file" capture="environment">` enables field workers to directly snap photos of physical warehouse receipts and produce inspection certificates.

### 2. Offline Mode & Sync Status (`MobileOfflineSyncStatus`)
- Detects network transitions (`online` / `offline`).
- Displays a status bar alerting the user when operating offline.
- Queues offline actions and surfaces a one-tap "Sync Now" button upon reconnecting.
