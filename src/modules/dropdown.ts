export function initCustomDropdowns() {
  document.querySelectorAll('select.filter-select').forEach(function(sel) {
    var select = sel as HTMLSelectElement;
    if (select.dataset.customized) return;
    select.dataset.customized = 'true';

    var wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    var trigger = document.createElement('button');
    trigger.className = 'custom-select-trigger';
    trigger.type = 'button';
    var selectedOpt = select.options[select.selectedIndex];
    trigger.textContent = selectedOpt ? selectedOpt.text : '';

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';

    buildOptions(select, panel, trigger, wrapper);

    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach(function(w) {
        if (w !== wrapper) w.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    select.style.display = 'none';
    if (select.parentNode) {
      select.parentNode.insertBefore(wrapper, select);
    }
    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);
    wrapper.appendChild(select);
  });

  if (!(window as any).__customSelectClickBound) {
    (window as any).__customSelectClickBound = true;
    document.addEventListener('click', function() {
      document.querySelectorAll('.custom-select.open').forEach(function(w) {
        w.classList.remove('open');
      });
    });
  }
}

function buildOptions(select: HTMLSelectElement, panel: HTMLElement, trigger: HTMLElement, wrapper: HTMLElement) {
  panel.innerHTML = '';
  Array.from(select.options).forEach(function(opt, i) {
    var item = document.createElement('div');
    item.className = 'custom-select-option' + (i === select.selectedIndex ? ' selected' : '');
    item.textContent = opt.text;
    item.dataset.value = opt.value;
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      select.value = opt.value;
      trigger.textContent = opt.text;
      panel.querySelectorAll('.custom-select-option').forEach(function(o) { o.classList.remove('selected'); });
      item.classList.add('selected');
      wrapper.classList.remove('open');
      select.dispatchEvent(new Event('change'));
    });
    panel.appendChild(item);
  });
}
