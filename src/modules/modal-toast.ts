var MODAL_EXIT_DURATION = 160;
var TOAST_EXIT_DELAY = 160;
var TOAST_VISIBLE_DURATION = 3000;
var modalCloseTimer = 0;

export function openModal(title, bodyHTML, footerHTML) {
  var overlay = document.getElementById('modalOverlay') as HTMLElement | null;
  if (modalCloseTimer) {
    clearTimeout(modalCloseTimer);
    modalCloseTimer = 0;
  }
  if (!overlay) return;
  document.getElementById('modalTitle')!.textContent = title;
  document.getElementById('modalBody')!.innerHTML = bodyHTML;
  document.getElementById('modalFooter')!.innerHTML = footerHTML;
  overlay.classList.remove('is-open', 'is-leaving');
  overlay.style.display = 'flex';
  void overlay.offsetHeight;
  requestAnimationFrame(function() {
    overlay.classList.add('is-open');
  });
}

export function closeModal() {
  var overlay = document.getElementById('modalOverlay') as HTMLElement | null;
  if (!overlay) return;
  if (modalCloseTimer) clearTimeout(modalCloseTimer);
  if (overlay.style.display === 'none' && !overlay.classList.contains('is-open')) return;
  overlay.classList.remove('is-open');
  overlay.classList.add('is-leaving');
  modalCloseTimer = window.setTimeout(function() {
    overlay.style.display = 'none';
    overlay.classList.remove('is-leaving');
    modalCloseTimer = 0;
  }, MODAL_EXIT_DURATION);
}

export function showToast(message, type) {
  var toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.style.cssText = 'background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;margin-top:8px;font-size:14px;color:#3f3f46;box-shadow:0 4px 12px rgba(0,0,0,0.1);min-width:200px;border-left:3px solid #22c55e';
  if (type === 'error') toast.style.borderLeftColor = '#ef4444';
  toast.textContent = message;
  var container = document.getElementById('toastContainer');
  if (!container) return;
  container.appendChild(toast);
  void toast.offsetHeight;
  requestAnimationFrame(function() {
    toast.classList.add('is-open');
  });
  window.setTimeout(function() {
    toast.classList.remove('is-open');
    toast.classList.add('is-leaving');
    window.setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, TOAST_EXIT_DELAY);
  }, TOAST_VISIBLE_DURATION);
}
