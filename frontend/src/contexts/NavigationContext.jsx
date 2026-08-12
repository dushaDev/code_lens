import React, { createContext, useContext } from 'react';

/**
 * NavigationContext — the single, app-wide redirect handler.
 *
 * The whole app routes on plain React state held in App.jsx (there is no
 * react-router). Cross-view jumps used to be threaded down as one-off props
 * (`onViewAnalytics`, `onNavigateTab`, `onBack`, …), which was easy to
 * mis-wire (e.g. a "Go to Settings" button that only cleared the project).
 *
 * Instead, App.jsx exposes one `navigate(target)` funnel through this context
 * and any component calls it via `useNavigation()` — no prop threading:
 *
 *   const { navigate } = useNavigation();
 *   navigate({ tab: 'settings', section: 'api-keys' });   // switch tab + deep-link
 *   navigate({ project });                                // open a project's analytics
 *   navigate({ projectId: 42 });                          // open by id (looked up)
 *   navigate({ tab: 'students', query: 'jdoe' });         // switch tab + preset search
 *   navigate({ course: null });                           // leave the course workspace
 *
 * `pendingSection` + `consumeSection` support deep-linking *within* a view: the
 * target view reads `pendingSection`, scrolls/focuses the matching element, then
 * calls `consumeSection()` so it fires once.
 */
const NavigationContext = createContext(null);

export const useNavigation = () => {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return ctx;
};

export const NavigationProvider = ({ value, children }) => (
  <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
);

export default NavigationContext;
