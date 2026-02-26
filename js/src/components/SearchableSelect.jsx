import React, { useEffect, useId, useRef, useState } from 'react';

const DEFAULT_BUTTON_CLASS =
  'relative block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400';

const DEFAULT_SEARCH_CLASS =
  'w-full px-3 py-2 rounded-md border border-base-300 bg-base-100 text-white focus:outline-none focus:ring-2 focus:ring-accent';

const MENU_VIEWPORT_GAP = 8;
const MIN_VISIBLE_LIST_HEIGHT = 80;
const FALLBACK_MENU_CHROME_HEIGHT = 60;
const DEFAULT_LIST_MAX_HEIGHT_PX = 240;

const isOptionObject = (option) =>
  option != null &&
  typeof option === 'object' &&
  (Object.prototype.hasOwnProperty.call(option, 'value') ||
    Object.prototype.hasOwnProperty.call(option, 'label'));

const normalizeOption = (option) => {
  if (isOptionObject(option)) {
    const value = option.value;
    const label = option.label ?? String(value ?? '');
    return {
      value,
      label,
      disabled: Boolean(option.disabled),
      searchText: String(option.searchText ?? label),
    };
  }

  return {
    value: option,
    label: String(option ?? ''),
    disabled: false,
    searchText: String(option ?? ''),
  };
};

const valuesMatch = (a, b) => a === b || String(a ?? '') === String(b ?? '');

const getFirstEnabledIndex = (options) => options.findIndex((option) => !option.disabled);

const splitSearchChunks = (text) =>
  String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

const compactLower = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// IntelliJ-like shorthand: "fulbooser" can match "FulfillmentBookingService"
// by consuming prefixes across chunks in order: ful + boo + ser.
const matchesChunkPrefixSequence = (query, chunks) => {
  let remaining = compactLower(query);
  if (!remaining) return true;

  for (const rawChunk of chunks) {
    if (!remaining) break;
    const chunk = compactLower(rawChunk);
    if (!chunk) continue;

    let matchLength = 0;
    while (
      matchLength < chunk.length &&
      matchLength < remaining.length &&
      chunk[matchLength] === remaining[matchLength]
    ) {
      matchLength += 1;
    }

    if (matchLength > 0) {
      remaining = remaining.slice(matchLength);
    }
  }

  return remaining.length === 0;
};

const matchesSearchQuery = (searchText, query) => {
  const rawQuery = String(query ?? '').trim();
  if (!rawQuery) return true;

  const target = String(searchText ?? '');
  const targetLower = target.toLowerCase();
  const queryLower = rawQuery.toLowerCase();

  // Fast path: plain contains search (current behavior)
  if (targetLower.includes(queryLower)) {
    return true;
  }

  const chunks = splitSearchChunks(target);
  const spacedTerms = rawQuery
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  // Space-separated matching: every term must match somewhere (AND semantics).
  // This is usually more useful than OR because it narrows results quickly.
  if (spacedTerms.length > 1) {
    return spacedTerms.every((term) => {
      const termLower = term.toLowerCase();
      return targetLower.includes(termLower) || matchesChunkPrefixSequence(term, chunks);
    });
  }

  // Compact shorthand matching across word/camel-case chunks.
  return matchesChunkPrefixSequence(rawQuery, chunks);
};

const isPrintableKey = (event) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

const SearchableSelect = ({
  id,
  value,
  onChange,
  options = [],
  disabled = false,
  placeholder = 'Select an option',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  searchPlaceholder = 'Type to filter...',
  listMaxHeightClassName = 'max-h-60',
  ariaLabel,
}) => {
  const fallbackId = useId();
  const selectId = id || fallbackId;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const listContainerRef = useRef(null);
  const optionButtonRefs = useRef([]);
  const highlightSourceRef = useRef('programmatic');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuPlacement, setMenuPlacement] = useState('bottom');
  const [menuListMaxHeight, setMenuListMaxHeight] = useState(null);

  const normalizedOptions = Array.isArray(options) ? options.map(normalizeOption) : [];
  const selectedOption = normalizedOptions.find((option) => valuesMatch(option.value, value)) || null;
  const displayLabel =
    selectedOption?.label ??
    (value !== undefined && value !== null && String(value) !== '' ? String(value) : placeholder);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredOptions = normalizedOptions.filter((option) =>
    normalizedSearch ? matchesSearchQuery(option.searchText, searchTerm) : true
  );

  const setHighlightedIndexWithSource = (index, source = 'programmatic') => {
    highlightSourceRef.current = source;
    setHighlightedIndex(index);
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndexWithSource(-1, 'programmatic');
      setMenuPlacement('bottom');
      setMenuListMaxHeight(null);
      return;
    }

    const selectedIndex = filteredOptions.findIndex((option) => valuesMatch(option.value, value));
    if (selectedIndex >= 0 && !filteredOptions[selectedIndex]?.disabled) {
      setHighlightedIndexWithSource(selectedIndex, 'programmatic');
      return;
    }

    setHighlightedIndexWithSource(getFirstEnabledIndex(filteredOptions), 'programmatic');
  }, [isOpen, searchTerm, value, options]);

  useEffect(() => {
    if (!isOpen) return undefined;

    let frameId = null;
    const viewport = window.visualViewport;

    const updateMenuLayout = () => {
      frameId = null;

      const triggerEl = triggerRef.current;
      if (!triggerEl) return;

      const triggerRect = triggerEl.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportBottom = viewportTop + viewportHeight;
      const availableBelow = Math.max(0, viewportBottom - triggerRect.bottom - MENU_VIEWPORT_GAP);
      const availableAbove = Math.max(0, triggerRect.top - viewportTop - MENU_VIEWPORT_GAP);

      const listEl = listContainerRef.current;
      const menuEl = menuRef.current;
      const listHeight = listEl?.offsetHeight ?? 0;
      const menuHeight = menuEl?.offsetHeight ?? 0;
      const menuChromeHeight =
        menuHeight > 0
          ? Math.max(0, menuHeight - listHeight)
          : FALLBACK_MENU_CHROME_HEIGHT;

      const preferredMenuHeight =
        menuHeight > 0 ? menuHeight : menuChromeHeight + DEFAULT_LIST_MAX_HEIGHT_PX;
      const shouldOpenAbove =
        availableAbove > availableBelow &&
        (availableBelow < preferredMenuHeight || availableBelow < MIN_VISIBLE_LIST_HEIGHT);
      const nextPlacement = shouldOpenAbove ? 'top' : 'bottom';
      const availableMenuHeight = nextPlacement === 'top' ? availableAbove : availableBelow;
      const nextListMaxHeight = Math.max(
        0,
        Math.floor(availableMenuHeight - menuChromeHeight)
      );

      setMenuPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      setMenuListMaxHeight((current) =>
        current === nextListMaxHeight ? current : nextListMaxHeight
      );
    };

    const scheduleUpdate = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(updateMenuLayout);
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    viewport?.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('scroll', scheduleUpdate);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    if (highlightSourceRef.current === 'pointer') return;

    const optionButton = optionButtonRefs.current[highlightedIndex];
    const listContainer = listContainerRef.current;
    if (!optionButton || !listContainer) return;

    const optionTop = optionButton.offsetTop;
    const optionBottom = optionTop + optionButton.offsetHeight;
    const viewTop = listContainer.scrollTop;
    const viewBottom = viewTop + listContainer.clientHeight;

    if (optionTop < viewTop) {
      listContainer.scrollTop = optionTop - 4;
      return;
    }

    if (optionBottom > viewBottom) {
      listContainer.scrollTop = optionBottom - listContainer.clientHeight + 4;
    }
  }, [highlightedIndex, isOpen, filteredOptions.length]);

  const openMenu = ({ seedSearch = '', focusSearch = false } = {}) => {
    if (disabled) return;
    setIsOpen(true);
    setSearchTerm(seedSearch);
    if (focusSearch) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.setSelectionRange(
          searchInputRef.current.value.length,
          searchInputRef.current.value.length
        );
      });
    }
  };

  const closeMenu = (keepFocus = true) => {
    setIsOpen(false);
    setSearchTerm('');
    if (keepFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const selectOption = (option) => {
    if (!option || option.disabled) return;
    onChange?.(option.value);
    closeMenu(false);
  };

  const moveHighlight = (direction) => {
    if (!filteredOptions.length) return;
    let nextIndex = highlightedIndex;

    for (let attempts = 0; attempts < filteredOptions.length; attempts += 1) {
      nextIndex =
        nextIndex < 0
          ? direction > 0
            ? 0
            : filteredOptions.length - 1
          : (nextIndex + direction + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[nextIndex]?.disabled) {
        setHighlightedIndexWithSource(nextIndex, 'keyboard');
        return;
      }
    }
  };

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
      } else {
        moveHighlight(1);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
      } else {
        moveHighlight(-1);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) {
        selectOption(filteredOptions[highlightedIndex]);
      } else {
        openMenu();
      }
      return;
    }

    if (isPrintableKey(event)) {
      event.preventDefault();
      const nextSearch = event.key;
      openMenu({ seedSearch: nextSearch, focusSearch: true });
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectOption(filteredOptions[highlightedIndex]);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        id={selectId}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`${DEFAULT_BUTTON_CLASS} text-left pr-10 ${buttonClassName}`.trim()}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`block whitespace-normal break-words leading-snug ${selectedOption ? '' : 'text-gray-400'}`.trim()}>
          {displayLabel}
        </span>
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`.trim()}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.513a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute left-0 z-50 min-w-full w-max max-w-[calc(100vw-1rem)] rounded-md border border-base-300 bg-base-200 shadow-xl p-2 ${
            menuPlacement === 'top' ? 'bottom-full mb-1' : 'mt-1'
          } ${menuClassName}`.trim()}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            className={DEFAULT_SEARCH_CLASS}
          />
          <div
            ref={listContainerRef}
            className={`mt-2 overflow-auto ${listMaxHeightClassName}`.trim()}
            style={
              menuListMaxHeight !== null
                ? { maxHeight: `${Math.max(menuListMaxHeight, 0)}px` }
                : undefined
            }
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            ) : (
              <ul role="listbox" aria-labelledby={selectId} className="space-y-1">
                {filteredOptions.map((option, index) => {
                  const isSelected = valuesMatch(option.value, value);
                  const isHighlighted = index === highlightedIndex;
                  return (
                    <li key={`${String(option.value)}-${index}`}>
                      <button
                        ref={(element) => {
                          optionButtonRefs.current[index] = element;
                        }}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={option.disabled}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          option.disabled
                            ? 'text-gray-500 cursor-not-allowed'
                            : isHighlighted
                              ? 'bg-accent text-white'
                              : isSelected
                                ? 'bg-base-300 text-white'
                                : 'hover:bg-base-300 text-gray-100'
                        }`.trim()}
                        onMouseEnter={() => !option.disabled && setHighlightedIndexWithSource(index, 'pointer')}
                        onClick={() => selectOption(option)}
                      >
                        <span className="block whitespace-normal break-words leading-snug">
                          {option.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
