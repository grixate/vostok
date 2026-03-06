import { useCallback, useState } from 'react';

// ─── Onboarding screens ─────────────────────────────────────────────────────
export type OnboardingScreen =
  | 'welcome'
  | 'invite'
  | 'create-account'
  | 'key-generation'
  | 'sign-in';

// ─── In-app sidebar navigation screens ───────────────────────────────────────
export type AppScreen =
  | 'chat-list'
  | 'compose'
  | 'new-group'
  | 'settings'
  | 'invite-sheet';

export type Screen = OnboardingScreen | AppScreen;

export interface NavigationStack<S extends Screen> {
  /** Current (top of stack) screen. */
  current: S;
  /** True when there is a previous screen to go back to. */
  canGoBack: boolean;
  /** Push a new screen onto the stack. */
  push: (screen: S) => void;
  /** Pop the current screen; no-op if already at root. */
  pop: () => void;
  /** Replace the current screen without adding to history. */
  replace: (screen: S) => void;
  /** Clear the stack and navigate to a new root screen. */
  reset: (screen: S) => void;
}

function useStack<S extends Screen>(initial: S): NavigationStack<S> {
  const [stack, setStack] = useState<S[]>([initial]);

  const push = useCallback((screen: S) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((screen: S) => {
    setStack((prev) => [...prev.slice(0, -1), screen]);
  }, []);

  const reset = useCallback((screen: S) => {
    setStack([screen]);
  }, []);

  return {
    current: stack[stack.length - 1],
    canGoBack: stack.length > 1,
    push,
    pop,
    replace,
    reset,
  };
}

/**
 * Navigation stack for the onboarding wizard.
 * Root is 'welcome'; screens flow forward and can be backed out of.
 */
export function useOnboardingNav(
  initial: OnboardingScreen = 'welcome'
): NavigationStack<OnboardingScreen> {
  return useStack<OnboardingScreen>(initial);
}

/**
 * Navigation stack for the in-app sidebar.
 * Root is 'chat-list'; pushing 'compose', 'settings', etc. slides a new view in.
 */
export function useAppNav(
  initial: AppScreen = 'chat-list'
): NavigationStack<AppScreen> {
  return useStack<AppScreen>(initial);
}
