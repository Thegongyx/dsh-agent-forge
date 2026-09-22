/**
 * The canvas's sidebar button.
 *
 * One glyph, drawn from `currentColor` so it inherits the shell's icon colour in
 * either theme. The sidebar entry owns the button and its label; this supplies
 * only the mark.
 *
 * @module dsh-agent-forge/client/PanelIcon
 */

import type { ReactNode } from 'react'

/** Props the sidebar passes to a panel-list entry. */
export interface PanelIconProps {
  /** Edge length the shell wants, in pixels. */
  size: number
  /** Whether this panel is the one currently shown. */
  active: boolean
}

/**
 * Renders the canvas icon: three delegations hanging off one root.
 * @param props - the sidebar's owner props.
 * @returns the glyph.
 */
export function PanelIcon(props: PanelIconProps): ReactNode {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="3" r="1.8" fill="currentColor" stroke="none" />
      <path d="M8 4.8v2.4M4 9.2V7.2h8v2" strokeLinecap="round" />
      <circle cx="4" cy="11.4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="11.4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.4" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
