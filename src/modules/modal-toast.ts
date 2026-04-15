export function openModal(title, bodyHTML, footerHTML) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalFooter').innerHTML = footerHTML;
  document.getElementById('modalOverlay').style.display = 'flex';
}

export function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

export function showToast(message, type) {
  var toast = document.createElement('div');
  toast.style.cssText = 'background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;margin-top:8px;font-size:14px;color:#3f3f46;box-shadow:0 4px 12px rgba(0,0,0,0.1);min-width:200px;border-left:3px solid #22c55e';
  if (type === 'error') toast.style.borderLeftColor = '#ef4444';
  toast.textContent = message;
  var container = document.getElementById('toastContainer');
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
}
