var DROPDOWN_EXIT_DURATION = 120

type CustomDropdownOptions = {
  searchable?: boolean;
  placeholder?: string;
  subtitleKey?: string;
}

function clearDropdownTimer(wrapper: HTMLElement) {
  var closeTimer = Number(wrapper.dataset.closeTimer || 0)
  if (!closeTimer) return
  clearTimeout(closeTimer)
  delete wrapper.dataset.closeTimer
}

function positionPanel(anchor: HTMLElement, panel: HTMLElement) {
  var rect = anchor.getBoundingClientRect();
  var vh = window.innerHeight;
  var panelH = panel.scrollHeight || 240;
  var spaceBelow = vh - rect.bottom;
  var spaceAbove = rect.top;
  
  panel.style.position = 'absolute';
  if (panelH > spaceBelow && spaceAbove > spaceBelow) {
    panel.style.top = 'auto';
    panel.style.bottom = 'calc(100% + 4px)';
    panel.style.maxHeight = Math.max(160, spaceAbove - 16) + 'px';
    panel.classList.add('flip-up');
  } else {
    panel.style.top = 'calc(100% + 4px)';
    panel.style.bottom = 'auto';
    panel.style.maxHeight = Math.max(160, spaceBelow - 16) + 'px';
    panel.classList.remove('flip-up');
  }
  panel.style.overflowY = 'auto';
}

function openDropdown(wrapper: HTMLElement) {
  clearDropdownTimer(wrapper)
  wrapper.classList.remove('is-leaving', 'is-open')
  void wrapper.offsetHeight
  requestAnimationFrame(function() {
    wrapper.classList.add('is-open')
  })
}

function closeDropdown(wrapper: HTMLElement) {
  clearDropdownTimer(wrapper)
  if (!wrapper.classList.contains('is-open') && !wrapper.classList.contains('is-leaving')) return
  wrapper.classList.remove('is-open')
  wrapper.classList.add('is-leaving')
  wrapper.dataset.closeTimer = String(window.setTimeout(function() {
    wrapper.classList.remove('is-leaving')
    delete wrapper.dataset.closeTimer
  }, DROPDOWN_EXIT_DURATION))
}

function closeOtherDropdowns(currentWrapper?: HTMLElement) {
  document.querySelectorAll('.custom-select.is-open, .custom-select.is-leaving').forEach(function(w) {
    if (w !== currentWrapper) closeDropdown(w as HTMLElement)
  })
}

function ensureDropdownWrapper(select: HTMLSelectElement) {
  var existingWrapper = select.closest('.custom-select') as HTMLElement | null
  if (existingWrapper) return existingWrapper
  var wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  select.style.display = 'none';
  if (select.parentNode) {
    select.parentNode.insertBefore(wrapper, select);
  }
  wrapper.appendChild(select);
  return wrapper
}

function buildDropdownPanel(select: HTMLSelectElement, wrapper: HTMLElement, opts?: CustomDropdownOptions) {
  clearDropdownTimer(wrapper)
  wrapper.className = 'custom-select'
  wrapper.classList.remove('is-open', 'is-leaving')
  select.style.display = 'none'

  var trigger = document.createElement('button');
  trigger.className = 'custom-select-trigger';
  trigger.type = 'button';
  var selectedOpt = select.options[select.selectedIndex];
  trigger.textContent = selectedOpt ? selectedOpt.text : '';

  var panel = document.createElement('div');
  panel.className = 'custom-select-panel' + (opts && opts.searchable ? ' searchable' : '');
  panel.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  if (opts && opts.searchable) {
    buildSearchableOptions(select, panel, trigger, wrapper, opts);
  } else {
    buildOptions(select, panel, trigger, wrapper);
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    if (wrapper.classList.contains('is-open')) {
      closeDropdown(wrapper);
      return;
    }
    closeOtherDropdowns(wrapper);
    positionPanel(trigger, panel);
    if (opts && opts.searchable) {
      var searchInput = panel.querySelector('.dropdown-search') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = '';
        panel.querySelectorAll('.dropdown-option.hidden').forEach(function(node) {
          node.classList.remove('hidden');
        });
      }
      panel.style.overflowY = 'hidden';
    }
    openDropdown(wrapper);
    if (opts && opts.searchable) {
      var input = panel.querySelector('.dropdown-search') as HTMLInputElement | null;
      if (input) {
        requestAnimationFrame(function() {
          input.focus();
        });
      }
    }
  });

  wrapper.insertBefore(trigger, select);
  wrapper.insertBefore(panel, select);
}

export function initCustomDropdowns() {
  document.querySelectorAll('select.filter-select').forEach(function(sel) {
    var select = sel as HTMLSelectElement;
    if (select.dataset.customized && select.closest('.custom-select')) return;
    select.dataset.customized = 'true';
    buildDropdownPanel(select, ensureDropdownWrapper(select));
  });

  if (!(window as any).__customSelectClickBound) {
    (window as any).__customSelectClickBound = true;
    document.addEventListener('click', function() {
      document.querySelectorAll('.custom-select.is-open, .custom-select.is-leaving').forEach(function(w) {
        closeDropdown(w as HTMLElement);
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
      closeDropdown(wrapper);
      select.dispatchEvent(new Event('change'));
    });
    panel.appendChild(item);
  });
}

function buildSearchableOptions(
  select: HTMLSelectElement,
  panel: HTMLElement,
  trigger: HTMLElement,
  wrapper: HTMLElement,
  opts: CustomDropdownOptions
) {
  panel.innerHTML = '';

  var searchWrap = document.createElement('div');
  searchWrap.className = 'dropdown-search-wrap';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'dropdown-search';
  input.placeholder = opts.placeholder || '搜索...';
  searchWrap.appendChild(input);

  var scroll = document.createElement('div');
  scroll.className = 'dropdown-options-scroll';

  Array.from(select.options).forEach(function(opt, i) {
    var item = document.createElement('div');
    item.className = 'dropdown-option' + (i === select.selectedIndex ? ' selected' : '');
    item.dataset.value = opt.value;
    item.dataset.sub = (opts.subtitleKey && opt.dataset[opts.subtitleKey]) || '';

    var name = document.createElement('div');
    name.className = 'dropdown-option-name';
    name.textContent = opt.text;

    item.appendChild(name);

    if (item.dataset.sub) {
      var sub = document.createElement('div');
      sub.className = 'dropdown-option-sub';
      sub.textContent = item.dataset.sub;
      item.appendChild(sub);
    }

    item.addEventListener('click', function(e) {
      e.stopPropagation();
      select.value = opt.value;
      trigger.textContent = opt.text;
      scroll.querySelectorAll('.dropdown-option').forEach(function(node) { node.classList.remove('selected'); });
      item.classList.add('selected');
      input.value = '';
      scroll.querySelectorAll('.dropdown-option.hidden').forEach(function(node) {
        node.classList.remove('hidden');
      });
      closeDropdown(wrapper);
      select.dispatchEvent(new Event('change'));
    });

    scroll.appendChild(item);
  });

  var filterOptions = function() {
    var query = input.value.trim().toLowerCase();
    scroll.querySelectorAll('.dropdown-option').forEach(function(node) {
      var item = node as HTMLElement;
      var nameEl = item.querySelector('.dropdown-option-name');
      var nameText = (nameEl && nameEl.textContent || '').toLowerCase();
      var subText = (item.dataset.sub || '').toLowerCase();
      var matched = !query || nameText.indexOf(query) >= 0 || subText.indexOf(query) >= 0;
      item.classList.toggle('hidden', !matched);
    });
  };

  input.addEventListener('input', filterOptions);
  input.addEventListener('keyup', filterOptions);

  panel.appendChild(searchWrap);
  panel.appendChild(scroll);
}

export function rebuildCustomDropdown(selectId: string, opts?: {
  searchable?: boolean;
  placeholder?: string;
  subtitleKey?: string;
}) {
  var select = document.getElementById(selectId) as HTMLSelectElement | null
  if (!select) return
  select.dataset.customized = 'true'
  var wrapper = ensureDropdownWrapper(select)
  wrapper.querySelectorAll('.custom-select-panel, .custom-select-trigger').forEach(function(node) {
    node.remove()
  })
  buildDropdownPanel(select, wrapper, opts)
}
