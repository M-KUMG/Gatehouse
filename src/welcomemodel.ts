// When the welcome card on an empty grid is shown. Pure rule, no DOM; welcome.ts draws the card.

export interface WelcomeInput {
  /** Parts on the grid. */
  parts: number;
  /** Wires on the grid. */
  wires: number;
  /** The user closed the card with its x (kept per user). */
  dismissed: boolean;
}

/** The card shows only on a completely empty grid, and never after it was closed. */
export function shouldShowWelcome({ parts, wires, dismissed }: WelcomeInput): boolean {
  return !dismissed && parts === 0 && wires === 0;
}
