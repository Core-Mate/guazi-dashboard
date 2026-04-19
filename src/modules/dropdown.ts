import { positionDropdown } from './dropdown-position'

var DROPDOWN_EXIT_DURATION = 120
var dropdownTriggerCounter = 0

type CustomDropdownOptions = {
  searchable?: boolean;
  placeholder?: string;
  subtitleKey?: string;
}

function nextDropdownTriggerId() {
  dropdownTriggerCounter += 1
  return 'custom-select-trigger-' + dropdownTriggerCounter
}

function clearDropdownTimer(wrapper: HTMLElement) {
  var closeTimer = Number(wrapper.dataset.closeTimer || 0)
  if (!closeTimer) return
  clearTimeout(closeTimer)
  delete wrapper.dataset.closeTimer
}

function getPanelForWrapper(wrapper: HTMLElement) {
  var triggerId = wrapper.dataset.triggerId
  if (!triggerId) return null
  return document.querySelector('.custom-select-panel[data-trigger-id="' + triggerId + '"]') as HTMLElement | null
}

function removePanelForWrapper(wrapper: HTMLElement) {
  var panel = getPanelForWrapper(wrapper)
  if (panel) panel.remove()
}

export function positionDropdownPanel(panel: HTMLElement, trigger: HTMLElement) {
  var triggerRect = trigger.getBoundingClientRect()
  var isMobile = window.innerWidth < 480

  panel.style.maxWidth = 'calc(100vw - 16px)'
  panel.style.minWidth = Math.min(triggerRect.width, Math.max(window.innerWidth - 16, 0)) + 'px'

  if (isMobile) {
    panel.classList.add('bottom-sheet')
    panel.style.width = Math.max(window.innerWidth - 16, 0) + 'px'
  } else {
    panel.classList.remove('bottom-sheet')
    panel.style.width = ''
  }

  var wasVisible = panel.classList.contains('open')
  var prevVisibility = panel.style.visibility
  if (!wasVisible) {
    panel.style.visibility = 'hidden'
    panel.classList.add('open')
  }
  var panelSize = { width: panel.offsetWidth, height: panel.offsetHeight }
  if (!wasVisible) {
    panel.classList.remove('open')
    panel.style.visibility = prevVisibility
  }

  var pos = positionDropdown(triggerRect, panelSize)
  panel.style.left = pos.left + 'px'
  panel.style.top = pos.top + 'px'
  if (pos.width === 'auto' || typeof pos.width === 'undefined') {
    panel.style.width = ''
  } else if (typeof pos.width === 'number') {
    panel.style.width = pos.width + 'px'
  }
  if (pos.bottomSheet) {
    panel.classList.add('bottom-sheet')
  } else {
    panel.classList.remove('bottom-sheet')
  }
}

function openDropdown(wrapper: HTMLElement) {
  var panel = getPanelForWrapper(wrapper)
  clearDropdownTimer(wrapper)
  wrapper.classList.remove('is-leaving')
  if (panel) panel.classList.remove('leaving')
  void wrapper.offsetHeight
  if (panel) void panel.offsetHeight
  requestAnimationFrame(function() {
    wrapper.classList.add('is-open')
    if (panel) panel.classList.add('open')
  })
}

function closeDropdown(wrapper: HTMLElement) {
  var panel = getPanelForWrapper(wrapper)
  clearDropdownTimer(wrapper)
  if (!wrapper.classList.contains('is-open') && !wrapper.classList.contains('is-leaving')) return
  wrapper.classList.remove('is-open')
  wrapper.classList.add('is-leaving')
  if (panel) {
    panel.classList.remove('open')
    panel.classList.add('leaving')
  }
  wrapper.dataset.closeTimer = String(window.setTimeout(function() {
    wrapper.classList.remove('is-leaving')
    if (panel) panel.classList.remove('leaving')
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
  removePanelForWrapper(wrapper)

  var triggerId = nextDropdownTriggerId()
  wrapper.dataset.triggerId = triggerId

  var trigger = document.createElement('button');
  trigger.className = 'custom-select-trigger';
  trigger.type = 'button';
  trigger.dataset.triggerId = triggerId
  var selectedOpt = select.options[select.selectedIndex];
  trigger.textContent = selectedOpt ? selectedOpt.text : '';

  var panel = document.createElement('div');
  panel.className = 'custom-select-panel' + (opts && opts.searchable ? ' searchable' : '');
  panel.dataset.triggerId = triggerId
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
    if (opts && opts.searchable) {
      var searchInput = panel.querySelector('.dropdown-search') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = '';
        panel.querySelectorAll('.dropdown-option.hidden').forEach(function(node) {
          node.classList.remove('hidden');
        });
      }
    }
    positionDropdownPanel(panel, trigger);
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
  document.body.appendChild(panel);
}

function repositionOpenDropdowns() {
  document.querySelectorAll('.custom-select.is-open').forEach(function(node) {
    var wrapper = node as HTMLElement
    var trigger = wrapper.querySelector('.custom-select-trigger') as HTMLElement | null
    var panel = getPanelForWrapper(wrapper)
    if (!trigger || !panel) return
    positionDropdownPanel(panel, trigger)
  })
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
    document.addEventListener('click', function(e) {
      var target = e.target as HTMLElement | null
      if (target && (target.closest('.custom-select-trigger') || target.closest('.custom-select-panel'))) return
      document.querySelectorAll('.custom-select.is-open, .custom-select.is-leaving').forEach(function(w) {
        closeDropdown(w as HTMLElement);
      });
    });
  }

  if (!(window as any).__customSelectResizeBound) {
    (window as any).__customSelectResizeBound = true;
    window.addEventListener('resize', repositionOpenDropdowns)
  }

  if (!(window as any).__customSelectScrollBound) {
    (window as any).__customSelectScrollBound = true
    window.addEventListener('scroll', repositionOpenDropdowns, true)
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
  clearDropdownTimer(wrapper)
  removePanelForWrapper(wrapper)
  wrapper.querySelectorAll('.custom-select-trigger').forEach(function(node) {
    node.remove()
  })
  buildDropdownPanel(select, wrapper, opts)
}
