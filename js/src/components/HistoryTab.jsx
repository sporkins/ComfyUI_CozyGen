import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, getViewUrl } from '../api';

const HISTORY_KEY = 'history';
const HISTORY_SELECTION_KEY = 'historySelection';

const isVideo = (url) => /\.(mp4|webm)/i.test(url);

const extractHistoryMedia = (historyEntry) => {
  const outputs = historyEntry?.outputs || {};
  const mediaUrls = [];

  Object.values(outputs).forEach((output) => {
    const outputImages = output?.images || output?.gifs || output?.videos;
    if (!Array.isArray(outputImages)) {
      return;
    }
    outputImages.forEach((image) => {
      if (!image) return;
      if (typeof image === 'string') {
        mediaUrls.push(getViewUrl(image));
        return;
      }
      if (!image.filename) return;
      mediaUrls.push(getViewUrl(image.filename, image.subfolder || '', image.type || 'output'));
    });
  });

  return mediaUrls;
};

const HistoryTab = () => {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [historyOutputs, setHistoryOutputs] = useState({});

  useEffect(() => {
    const loadHistory = () => {
      const storedHistory = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
      setHistoryItems(storedHistory);
    };

    loadHistory();
    const handleStorage = (event) => {
      if (event.key === HISTORY_KEY) {
        loadHistory();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (historyItems.length === 0) {
      return;
    }

    const fetchOutputs = async () => {
      const outputsById = {};
      await Promise.all(historyItems.map(async (item) => {
        if (!item?.id) return;
        if (historyOutputs[item.id]) return;
        try {
          const historyData = await getHistory(item.id);
          const historyEntry = historyData?.[item.id] || historyData?.history?.[item.id];
          if (historyEntry) {
            outputsById[item.id] = historyEntry;
          }
        } catch (error) {
          console.warn(`CozyGen: failed to fetch history for ${item.id}`, error);
        }
      }));

      if (Object.keys(outputsById).length > 0) {
        setHistoryOutputs((prev) => ({ ...prev, ...outputsById }));
      }
    };

    fetchOutputs();
  }, [historyItems]);

  const sortedHistoryItems = useMemo(() => [...historyItems].reverse(), [historyItems]);

  const handleHistoryClick = (item) => {
    localStorage.setItem(HISTORY_SELECTION_KEY, JSON.stringify(item));
    navigate('/');
  };

  if (sortedHistoryItems.length === 0) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
        No history entries yet. Generate something to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {sortedHistoryItems.map((item) => {
        const historyEntry = historyOutputs[item.id];
        const mediaUrls = extractHistoryMedia(historyEntry);
        const timestamp = item.timestamp ? new Date(item.timestamp) : null;

        return (
          <div
            key={item.id}
            className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3 cursor-pointer hover:bg-base-300/70 transition-colors"
            onClick={() => handleHistoryClick(item)}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="text-sm text-gray-400">Prompt ID</p>
                <p className="text-white font-semibold break-all">{item.id}</p>
              </div>
              <div className="text-sm text-gray-400">
                {timestamp ? timestamp.toLocaleString() : 'Unknown time'}
              </div>
            </div>
            {mediaUrls.length === 0 && (
              <p className="text-sm text-gray-400">
                {historyEntry ? 'No previews found for this prompt.' : 'Loading previews...'}
              </p>
            )}
            {mediaUrls.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {mediaUrls.map((url, index) => (
                  <div key={`${item.id}-${index}`} className="aspect-square bg-base-300 rounded-lg overflow-hidden">
                    {isVideo(url) ? (
                      <video src={url} muted loop className="w-full h-full object-cover" />
                    ) : (
                      <img src={url} alt="History preview" className="w-full h-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HistoryTab;
