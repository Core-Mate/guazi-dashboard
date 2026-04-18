var loaderEl: HTMLElement | null = null
var showTimer: number | null = null
var isShowing = false

function getEl() {
  if (!loaderEl) loaderEl = document.getElementById('globalLoader')
  return loaderEl
}

export function showLoader(opts?: { immediate?: boolean }) {
  if (opts && opts.immediate) {
    isShowing = true
    if (showTimer !== null) {
      window.clearTimeout(showTimer)
      showTimer = null
    }
    var immediateEl = getEl()
    if (immediateEl) immediateEl.classList.remove('hidden')
    return
  }
  if (isShowing) {
    if (showTimer !== null) return
    var currentEl = getEl()
    if (!currentEl || !currentEl.classList.contains('hidden')) return
  }
  isShowing = true
  if (showTimer !== null) {
    window.clearTimeout(showTimer)
  }
  showTimer = window.setTimeout(function() {
    showTimer = null
    var el = getEl()
    if (!el) return
    el.classList.remove('hidden')
  }, 250)
}

export function hideLoader() {
  isShowing = false
  if (showTimer !== null) {
    window.clearTimeout(showTimer)
    showTimer = null
    return
  }
  var el = getEl()
  if (!el) return
  el.classList.add('hidden')
}
