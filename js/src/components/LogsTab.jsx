import React, { useEffect, useRef, useState } from 'react';
import { clearCozyLogs, getCozyLogs, saveCozyLogsConfig } from '../api';

const POLL_INTERVAL_MS = 1000;

const formatTs = (ts) => {
  if (!ts) return '--:--:--';
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString();
};

const trimToBuffer = (items, config) => {
  if (!Array.isArray(items)) return [];
  if (config?.infinite) return items;
  const max = Number(config?.max_buffer);
  if (!Number.isFinite(max) || max < 1) return items;
  return items.slice(-max);
};

const LogsTab = () => {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [config, setConfig] = useState({ max_buffer: 5000, infinite: false });
  const [maxBufferInput, setMaxBufferInput] = useState('5000');
  const [infiniteInput, setInfiniteInput] = useState(false);
  const [backfillCount, setBackfillCount] = useState('200');
  const [autoScroll, setAutoScroll] = useState(true);

  const cursorRef = useRef(null);
  const hydratedConfigRef = useRef(false);
  const listRef = useRef(null);
  const configRef = useRef(config);
  const backfillRef = useRef(backfillCount);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    backfillRef.current = backfillCount;
  }, [backfillCount]);

  const fetchLogs = async (reset = false) => {
    try {
      const parsedBackfill = Math.max(1, Number.parseInt(backfillRef.current, 10) || 200);
      const response = reset || cursorRef.current == null
        ? await getCozyLogs({ limit: parsedBackfill })
        : await getCozyLogs({ afterId: cursorRef.current });

      const nextConfig = response?.config && typeof response.config === 'object'
        ? response.config
        : configRef.current;
      setConfig(nextConfig);

      if (!hydratedConfigRef.current) {
        hydratedConfigRef.current = true;
        setInfiniteInput(Boolean(nextConfig?.infinite));
        setMaxBufferInput(String(nextConfig?.max_buffer ?? 5000));
      }

      const incoming = Array.isArray(response?.items) ? response.items : [];
      const shouldReset = reset || Boolean(response?.reset) || cursorRef.current == null;

      setEntries((prev) => {
        const next = shouldReset ? incoming : [...prev, ...incoming];
        return trimToBuffer(next, nextConfig);
      });

      cursorRef.current = Number.isFinite(Number(response?.latest_id)) ? Number(response.latest_id) : cursorRef.current;
      setError('');
    } catch (err) {
      console.error('CozyGen: failed to fetch logs', err);
      setError('Unable to load logs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!active) return;
      await fetchLogs(true);
    };

    run();
    const interval = setInterval(() => {
      fetchLogs(false);
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoScroll]);

  const handleRefresh = async () => {
    cursorRef.current = null;
    setIsLoading(true);
    await fetchLogs(true);
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      const nextConfig = await clearCozyLogs();
      cursorRef.current = null;
      setEntries([]);
      if (nextConfig && typeof nextConfig === 'object') {
        setConfig(nextConfig);
      }
      setError('');
      await fetchLogs(true);
    } catch (err) {
      console.error('CozyGen: failed to clear logs', err);
      setError('Failed to clear logs.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const payload = { infinite: Boolean(infiniteInput) };
      if (!infiniteInput) {
        const parsed = Number.parseInt(maxBufferInput, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new Error('Invalid max buffer');
        }
        payload.max_buffer = parsed;
      }
      const saved = await saveCozyLogsConfig(payload);
      const nextConfig = {
        max_buffer: saved?.max_buffer ?? null,
        infinite: Boolean(saved?.infinite),
      };
      setConfig(nextConfig);
      hydratedConfigRef.current = true;
      setInfiniteInput(Boolean(nextConfig.infinite));
      setMaxBufferInput(String(nextConfig.max_buffer ?? maxBufferInput));
      setEntries((prev) => trimToBuffer(prev, nextConfig));
      setError('');
    } catch (err) {
      console.error('CozyGen: failed to save logs config', err);
      setError('Failed to save logs settings.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Logs</h2>
          <p className="text-sm text-gray-400">
            Live tail of CozyGen/Comfy output captured from stdout, stderr, and Python logging.
          </p>
        </div>
        <div className="text-sm text-gray-400">
          {config.infinite ? 'Buffer: infinite' : `Buffer: ${config.max_buffer ?? 'unknown'} max`} | Showing {entries.length}
        </div>
      </div>

      {error && (
        <div className="bg-base-200 border border-red-500/50 text-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="block text-sm text-gray-300">Initial Backfill</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                className="input input-bordered input-sm w-full bg-base-300"
                value={backfillCount}
                onChange={(e) => setBackfillCount(e.target.value)}
              />
              <button
                type="button"
                onClick={handleRefresh}
                className="btn btn-sm"
                disabled={isLoading}
              >
                Reload
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-gray-300">Buffer Settings</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={infiniteInput}
                  onChange={(e) => setInfiniteInput(e.target.checked)}
                />
                Infinite
              </label>
              <input
                type="number"
                min="1"
                className="input input-bordered input-sm w-28 bg-base-300"
                value={maxBufferInput}
                disabled={infiniteInput}
                onChange={(e) => setMaxBufferInput(e.target.value)}
                placeholder="Max"
              />
              <button
                type="button"
                onClick={handleSaveConfig}
                className="btn btn-sm"
                disabled={isSavingConfig}
              >
                Save
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-gray-300">Actions</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
              <button
                type="button"
                onClick={handleClear}
                className="btn btn-sm btn-error"
                disabled={isClearing}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        className="bg-base-200 shadow-lg rounded-lg p-3 h-[65vh] overflow-auto font-mono text-xs leading-5"
      >
        {isLoading && entries.length === 0 ? (
          <div className="text-gray-400">Loading logs...</div>
        ) : entries.length === 0 ? (
          <div className="text-gray-400">No logs captured yet.</div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <div key={entry.id} className="flex gap-2 text-gray-200">
                <span className="text-gray-500 shrink-0">{formatTs(entry.ts)}</span>
                <span className="text-gray-400 shrink-0">[{entry.source || 'log'}]</span>
                <span className="whitespace-pre-wrap break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsTab;
