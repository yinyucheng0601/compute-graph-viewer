(function attachPtoFloatingPlaybackControl(global) {
  'use strict';

  const DEFAULT_IDS = {
    shell: 'floating-shell',
    toggle: 'floating-toggle',
    collapsedButton: 'floating-collapsed-btn',
    collapsedIcon: 'floating-collapsed-icon',
    controls: 'controls-row',
    stepBack: 'step-back-btn',
    play: 'play-btn',
    stepForward: 'step-fwd-btn',
    replay: 'replay-btn',
    scrubber: 'scrubber',
    scrubberLabel: 'scrubber-label',
    scrubberOpname: 'scrubber-opname',
    scrubberHover: 'scrubber-hover',
  };

  const isElement = (target) => target && target.nodeType === 1;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asRoot(root) {
    return isElement(root) || root === document ? root : document;
  }

  function ownerDocument(root) {
    return root?.ownerDocument || document;
  }

  function find(root, target, selector, id) {
    if (isElement(target)) return target;
    const scope = asRoot(root);
    if (typeof target === 'string') return scope.querySelector(target);
    return scope.querySelector(selector) || ownerDocument(scope).getElementById(id);
  }

  const LUCIDE_ICONS = {
    chevronDown: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
    pause: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>',
    play: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>',
    replay: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
    skipBack: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" x2="5" y1="19" y2="5"></line></svg>',
    skipForward: '<svg class="pto-floating-playback__icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>',
  };

  function iconLabel(iconName, text = '') {
    const icon = LUCIDE_ICONS[iconName] || '';
    return text ? `${icon}<span>${escapeHtml(text)}</span>` : icon;
  }

  function createButton({ id, className = '', label, title, primary = false }) {
    const classes = [
      'pto-floating-playback__button',
      primary ? 'pto-floating-playback__button--primary' : '',
      className,
    ].filter(Boolean).join(' ');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<button class="${classes}" id="${escapeHtml(id)}" type="button"${titleAttr}>${label}</button>`;
  }

  function createControl(options = {}) {
    const ids = { ...DEFAULT_IDS, ...(options.ids || {}) };
    const showTimeline = options.showTimeline !== false;
    const timelineMarkup = showTimeline ? `
          <div class="pto-floating-playback__sep" aria-hidden="true"></div>
          <div class="pto-floating-playback__group pto-floating-playback__group--timeline">
            <div class="pto-floating-playback__meta">
              <label class="pto-floating-playback__label" for="${escapeHtml(ids.scrubber)}">Timeline</label>
              <label id="${escapeHtml(ids.scrubberLabel)}" class="pto-floating-playback__counter" for="${escapeHtml(ids.scrubber)}">0 / 127</label>
              <span id="${escapeHtml(ids.scrubberOpname)}" class="pto-floating-playback__opname">-</span>
            </div>
            <div class="pto-floating-playback__scrubber-wrap">
              <input class="pto-floating-playback__scrubber" type="range" id="${escapeHtml(ids.scrubber)}" min="0" max="127" value="0" step="1">
              <div id="${escapeHtml(ids.scrubberHover)}" class="pto-floating-playback__hover" aria-hidden="true"></div>
            </div>
          </div>
    ` : '';
    const root = document.createElement('div');
    root.className = ['pto-floating-playback', options.className].filter(Boolean).join(' ');
    if (options.id) root.id = options.id;
    root.innerHTML = `
      <div id="${escapeHtml(ids.shell)}" class="pto-floating-playback__shell is-expanded">
        <button id="${escapeHtml(ids.toggle)}" class="pto-floating-playback__toggle" type="button" aria-label="Collapse playback toolbar" aria-expanded="true">
          <span class="pto-floating-playback__toggle-icon">${LUCIDE_ICONS.chevronDown}</span>
        </button>
        <button id="${escapeHtml(ids.collapsedButton)}" class="pto-floating-playback__collapsed-button" type="button" aria-label="Expand playback toolbar">
          <span id="${escapeHtml(ids.collapsedIcon)}" class="pto-floating-playback__collapsed-icon">${LUCIDE_ICONS.play}</span>
        </button>
        <div id="${escapeHtml(ids.controls)}" class="pto-floating-playback__controls">
          <div class="pto-floating-playback__group pto-floating-playback__group--playback">
            ${createButton({ id: ids.stepBack, label: iconLabel('skipBack'), title: 'Previous step' })}
            ${createButton({ id: ids.play, label: iconLabel('play', 'Play'), primary: true })}
            ${createButton({ id: ids.stepForward, label: iconLabel('skipForward'), title: 'Next step' })}
            ${createButton({ id: ids.replay, label: iconLabel('replay', 'Replay'), title: 'Replay from step 0' })}
          </div>
          ${timelineMarkup}
        </div>
      </div>
    `;
    return root;
  }

  function getElements(options = {}) {
    const root = asRoot(options.root);
    return {
      root,
      shell: find(root, options.shell, '.pto-floating-playback__shell', DEFAULT_IDS.shell),
      toggle: find(root, options.toggle, '.pto-floating-playback__toggle', DEFAULT_IDS.toggle),
      collapsedButton: find(root, options.collapsedButton, '.pto-floating-playback__collapsed-button', DEFAULT_IDS.collapsedButton),
      collapsedIcon: find(root, options.collapsedIcon, '.pto-floating-playback__collapsed-icon', DEFAULT_IDS.collapsedIcon),
      controls: find(root, options.controls, '.pto-floating-playback__controls', DEFAULT_IDS.controls),
      scrubber: find(root, options.scrubber, '.pto-floating-playback__scrubber', DEFAULT_IDS.scrubber),
      scrubberHover: find(root, options.scrubberHover || options.hover, '.pto-floating-playback__hover', DEFAULT_IDS.scrubberHover),
    };
  }

  function readPlaying(options = {}) {
    if (typeof options.isPlaying === 'function') return !!options.isPlaying();
    return !!options.playing;
  }

  function syncElements(elements, options = {}) {
    const { shell, toggle, collapsedIcon } = elements;
    if (!shell) return false;
    const expanded = !shell.classList.contains('is-collapsed');
    shell.classList.toggle('is-expanded', expanded);
    shell.classList.toggle('is-collapsed', !expanded);
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.setAttribute('aria-label', expanded ? 'Collapse playback toolbar' : 'Expand playback toolbar');
    }
    if (collapsedIcon) {
      collapsedIcon.innerHTML = readPlaying(options) ? LUCIDE_ICONS.pause : LUCIDE_ICONS.play;
    }
    return expanded;
  }

  function setExpandedElements(elements, expanded, options = {}) {
    const { shell } = elements;
    if (!shell) return false;
    shell.classList.toggle('is-collapsed', !expanded);
    shell.classList.toggle('is-expanded', expanded);
    return syncElements(elements, options);
  }

  function init(options = {}) {
    const elements = getElements(options);
    const destroyFns = [];
    const stateOptions = () => ({ ...options, playing: readPlaying(options) });

    const sync = (state = {}) => syncElements(elements, { ...stateOptions(), ...state });
    const setExpanded = (expanded, state = {}) => setExpandedElements(elements, expanded, { ...stateOptions(), ...state });

    if (elements.toggle) {
      const onToggle = () => {
        const expanded = elements.shell?.classList.contains('is-expanded');
        setExpanded(!expanded);
        options.onToggle?.(!expanded);
      };
      elements.toggle.addEventListener('click', onToggle);
      destroyFns.push(() => elements.toggle.removeEventListener('click', onToggle));
    }

    if (elements.collapsedButton) {
      const onCollapsedButton = () => {
        const expanded = elements.shell?.classList.contains('is-expanded');
        if (expanded) {
          options.onExpandedCollapsedButtonClick?.();
          return;
        }
        setExpanded(true);
        options.onCollapsedButtonClick?.();
      };
      elements.collapsedButton.addEventListener('click', onCollapsedButton);
      destroyFns.push(() => elements.collapsedButton.removeEventListener('click', onCollapsedButton));
    }

    sync();

    return {
      elements,
      sync,
      setExpanded,
      isExpanded: () => !!elements.shell?.classList.contains('is-expanded'),
      destroy: () => destroyFns.splice(0).forEach((destroy) => destroy()),
    };
  }

  function initScrubberHover(options = {}) {
    const elements = getElements(options);
    const scrubber = elements.scrubber;
    const hover = elements.scrubberHover;
    if (!scrubber || !hover) {
      return {
        update: () => {},
        show: () => {},
        hide: () => {},
        destroy: () => {},
      };
    }

    const totalSteps = () => {
      if (typeof options.getTotalSteps === 'function') return Number(options.getTotalSteps()) || 1;
      return Number(options.totalSteps) || 1;
    };

    const labelForStep = (step) => {
      if (typeof options.getLabelForStep === 'function') return options.getLabelForStep(step);
      return `Step ${step}`;
    };

    const update = (clientX) => {
      const rect = scrubber.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
      const step = Math.round(ratio * Math.max(0, totalSteps() - 1));
      hover.textContent = labelForStep(step);
      hover.style.left = `${ratio * rect.width}px`;
      return step;
    };

    const show = () => hover.classList.add('visible');
    const hide = () => hover.classList.remove('visible');
    const onPointerMove = (event) => {
      update(event.clientX);
      show();
    };

    scrubber.addEventListener('pointermove', onPointerMove);
    scrubber.addEventListener('pointerdown', show);
    scrubber.addEventListener('pointerleave', hide);
    scrubber.addEventListener('change', hide);

    return {
      update,
      show,
      hide,
      destroy: () => {
        scrubber.removeEventListener('pointermove', onPointerMove);
        scrubber.removeEventListener('pointerdown', show);
        scrubber.removeEventListener('pointerleave', hide);
        scrubber.removeEventListener('change', hide);
      },
    };
  }

  global.PtoFloatingPlaybackControl = {
    icons: LUCIDE_ICONS,
    iconLabel,
    createControl,
    getElements,
    init,
    initScrubberHover,
    setExpanded: (options = {}, expanded) => setExpandedElements(getElements(options), expanded, options),
    sync: (options = {}) => syncElements(getElements(options), options),
  };

  global.PtoFloatingPlaybackControlPattern = global.PtoFloatingPlaybackControl;
})(window);
