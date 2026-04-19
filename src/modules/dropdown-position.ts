export interface DropdownPositionOpts {
  viewport?: { width: number; height: number }
  preferredGap?: number
  clampMargin?: number
  mobileBreakpoint?: number
}

export interface DropdownPosition {
  left: number
  top: number
  width?: number | 'auto'
  bottomSheet?: boolean
}

export function positionDropdown(
  triggerRect: DOMRect,
  panelSize: { width: number; height: number },
  opts?: DropdownPositionOpts
): DropdownPosition {
  const vw = opts?.viewport?.width ?? window.innerWidth
  const vh = opts?.viewport?.height ?? window.innerHeight
  const gap = opts?.preferredGap ?? 4
  const margin = opts?.clampMargin ?? 8
  const mobileBp = opts?.mobileBreakpoint ?? 480

  if (vw < mobileBp) {
    return {
      left: margin,
      top: vh - panelSize.height - margin,
      width: vw - margin * 2,
      bottomSheet: true,
    }
  }

  let left = triggerRect.left
  if (left + panelSize.width > vw - margin) {
    left = vw - panelSize.width - margin
  }
  if (left < margin) left = margin

  let top = triggerRect.bottom + gap
  if (top + panelSize.height > vh - margin) {
    const topSpace = triggerRect.top - gap - margin
    if (topSpace >= panelSize.height) {
      top = triggerRect.top - panelSize.height - gap
    } else {
      top = vh - panelSize.height - margin
    }
  }

  return { left, top }
}
