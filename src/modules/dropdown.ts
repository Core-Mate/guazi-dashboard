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

export function positionDropdownPanel(panel: HTMLElement, trigger: HTMLElement) {
  var rect = trigger.getBoundingClientRect()
  var vw = window.innerWidth
  var vh = window.innerHeight

  panel.classList.remove('flip-up')
  panel.style.position = 'fixed'
  panel.style.top = rect.bottom + 4 + 'px'
  panel.style.left = rect.left + 'px'
  panel.style.bottom = ''
  panel.style.right = ''
  panel.style.width = ''
  panel.style.minWidth = Math.min(rect.width, vw - 16) + 'px'
  panel.style.maxWidth = 'calc(100vw - 16px)'

  var prevVisibility = panel.style.visibility
  var prevPointerEvents = panel.style.pointerEvents
  var prevTransform = panel.style.transform
  var prevTransition = panel.style.transition

  panel.style.visibility = 'hidden'
  panel.style.pointerEvents = 'none'
  panel.style.maxHeight = 'none'
  panel.style.transform = 'none'
  panel.style.transition = 'none'

  void panel.offsetHeight

  var panelRect = panel.getBoundingClientRect()
  var panelWidth = panelRect.width
  var panelHeight = panelRect.height
  var nextLeft = rect.left

  if (nextLeft + panelWidth > vw - 8) {
    nextLeft = rect.right - panelWidth
  }
  if (nextLeft + panelWidth > vw - 8) {
    nextLeft = Math.max(8, vw - panelWidth - 8)
  }
  if (nextLeft < 8) {
    nextLeft = 8
  }

  var nextTop = rect.bottom + 4
  var availableHeight = vh - rect.bottom - 12
  if (rect.bottom + panelHeight > vh - 8) {
    panel.classList.add('flip-up')
    nextTop = Math.max(8, rect.top - panelHeight - 4)
    availableHeight = rect.top - 12
  }

  panel.style.left = nextLeft + 'px'
  panel.style.top = nextTop + 'px'
  panel.style.maxHeight = Math.max(120, availableHeight) + 'px'
  panel.style.overflowY = panel.classList.contains('searchable') ? 'hidden' : 'auto'

  panel.style.visibility = prevVisibility
  panel.style.pointerEvents = prevPointerEvents
  panel.style.transform = prevTransform
  panel.style.transition = prevTransition
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
    positionDropdownPanel(panel, trigger);
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

  if (!(window as any).__customSelectResizeBound) {
    (window as any).__customSelectResizeBound = true;
    window.addEventListener('resize', function() {
      document.querySelectorAll('.custom-select.is-open').forEach(function(node) {
        var wrapper = node as HTMLElement
        var trigger = wrapper.querySelector('.custom-select-trigger') as HTMLElement | null
        var panel = wrapper.querySelector('.custom-select-panel') as HTMLElement | null
        if (!trigger || !panel) return
        positionDropdownPanel(panel, trigger)
      })
    })
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
