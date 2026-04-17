var loaderEl: HTMLElement | null = null
var hideTimer: number | null = null
var pendingCount = 0

function getEl() {
  if (!loaderEl) loaderEl = document.getElementById('globalLoader')
  return loaderEl
}

export function showLoader() {
  pendingCount++
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  var el = getEl()
  if (el) el.classList.remove('hidden')
}

export function hideLoader() {
  pendingCount = Math.max(0, pendingCount - 1)
  if (pendingCount > 0) return
  var el = getEl()
  if (!el) return
  hideTimer = window.setTimeout(function() {
    el.classList.add('hidden')
    hideTimer = null
  }, 120)
}
