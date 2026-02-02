import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteQueueItem, getQueue, interruptQueue, queuePrompt } from '../api';

const HISTORY_KEY = 'history';
const POLL_INTERVAL_MS = 5000;

const extractPromptId = (item) => {
  if (!item) return null;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item.prompt_id === 'string' || typeof item.prompt_id === 'number') return String(item.prompt_id);
  if (Array.isArray(item) && (typeof item[0] === 'string' || typeof item[0] === 'number')) return String(item[0]);
  if (Array.isArray(item) && item[1] && (typeof item[1].prompt_id === 'string' || typeof item[1].prompt_id === 'number')) {
    return String(item[1].prompt_id);
  }
  return null;
};

const extractWorkflow = (item) => {
  if (!item) return null;
  if (item.prompt) return item.prompt;
  if (Array.isArray(item) && item[1]) {
    if (item[1].prompt) return item[1].prompt;
    if (item[1].workflow) return item[1].workflow;
  }
  if (item.workflow) return item.workflow;
  return null;
};

const QueueTab = () => {
  const [queueState, setQueueState] = useState({ running: [], pending: [] });
  const [queueRemaining, setQueueRemaining] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const historyById = useMemo(() => {
    const storedHistory = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    return storedHistory.reduce((acc, item) => {
      if (item?.id) {
        acc[item.id] = item;
      }
      return acc;
    }, {});
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await getQueue();
      const running = Array.isArray(data?.queue_running) ? data.queue_running : [];
      const pending = Array.isArray(data?.queue_pending) ? data.queue_pending : [];
      if (Array.isArray(data) && data.length > 0) {
        setQueueState({ running: data, pending: [] });
      } else {
        setQueueState({ running, pending });
      }
      setError('');
    } catch (err) {
      console.error('CozyGen: failed to fetch queue', err);
      setError('Unable to load queue data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  useEffect(() => {
    const protocol = window.location.protocol.startsWith('https') ? 'wss' : 'ws';
    const host = window.location.host;
    const wsUrl = `${protocol}://${host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        const remaining = msg?.data?.status?.exec_info?.queue_remaining;
        if (typeof remaining === 'number') {
          setQueueRemaining(remaining);
        }
      }
    };

    return () => socket.close();
  }, []);

  const normalizeItems = useCallback((items, status) => (
    items.map((item) => {
      const promptId = extractPromptId(item);
      return {
        promptId,
        status,
        raw: item,
        workflow: extractWorkflow(item),
        historyWorkflow: promptId ? historyById?.[promptId]?.json?.prompt || historyById?.[promptId]?.json : null,
      };
    })
  ), [historyById]);

  const runningItems = useMemo(() => normalizeItems(queueState.running, 'running'), [queueState.running, normalizeItems]);
  const pendingItems = useMemo(() => normalizeItems(queueState.pending, 'pending'), [queueState.pending, normalizeItems]);
  const allItems = [...runningItems, ...pendingItems];

  const handleCancel = async (promptId) => {
    if (!promptId) return;
    try {
      await deleteQueueItem(promptId);
      await fetchQueue();
    } catch (err) {
      console.error('CozyGen: failed to cancel queue item', err);
      setError('Failed to cancel queue item.');
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptQueue();
      await fetchQueue();
    } catch (err) {
      console.error('CozyGen: failed to interrupt queue', err);
      setError('Failed to interrupt running prompt.');
    }
  };

  const handleRequeue = async (workflow) => {
    if (!workflow) {
      setError('No workflow data available to re-queue.');
      return;
    }
    try {
      const payload = workflow?.prompt ? workflow : { prompt: workflow };
      await queuePrompt(payload);
      await fetchQueue();
    } catch (err) {
      console.error('CozyGen: failed to re-queue prompt', err);
      setError('Failed to re-queue prompt.');
    }
  };

  if (isLoading) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
        Loading queue...
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
        Queue is empty.
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-xl font-semibold text-white">Queue</h2>
        {typeof queueRemaining === 'number' && (
          <span className="text-sm text-gray-400">
            Queue remaining: {queueRemaining}
          </span>
        )}
      </div>
      {error && (
        <div className="bg-base-200 border border-red-500/50 text-red-200 rounded-lg p-3">
          {error}
        </div>
      )}
      <div className="overflow-x-auto bg-base-200 shadow-lg rounded-lg">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-base-300 text-gray-300">
            <tr>
              <th className="px-4 py-3 font-medium">Prompt ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item, index) => {
              const workflowPayload = item.workflow || item.historyWorkflow;
              return (
                <tr key={`${item.status}-${item.promptId || index}`} className="border-t border-base-300">
                  <td className="px-4 py-3 text-gray-200 break-all">
                    {item.promptId || 'Unknown'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 capitalize">{item.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {item.status === 'running' && (
                        <button
                          onClick={handleInterrupt}
                          className="px-3 py-1 rounded-md bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 transition-colors"
                        >
                          Interrupt
                        </button>
                      )}
                      <button
                        onClick={() => handleCancel(item.promptId)}
                        className="px-3 py-1 rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors"
                        disabled={!item.promptId}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRequeue(workflowPayload)}
                        className="px-3 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                        disabled={!workflowPayload}
                        title={workflowPayload ? 'Re-queue this prompt' : 'Workflow data unavailable'}
                      >
                        Re-queue
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default QueueTab;
