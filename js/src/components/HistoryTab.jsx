import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, getThumbUrl, getViewUrl, getCozyHistoryList } from '../api';
import LazyMedia from './LazyMedia';

const HISTORY_SELECTION_KEY = 'historySelection';

const isVideo = (url) => /\.(mp4|webm)/i.test(url);
const isGif = (url) => /\.(gif)/i.test(url);

const extractHistoryMedia = (historyEntry) => {
  const outputs = historyEntry?.outputs || {};
  const mediaItems = [];

  Object.values(outputs).forEach((output) => {
    const outputImages = output?.images || output?.gifs || output?.videos;
    if (!Array.isArray(outputImages)) {
      return;
    }
    outputImages.forEach((image) => {
      if (!image) return;
      if (typeof image === 'string') {
        mediaItems.push({
          filename: image,
          subfolder: '',
          type: 'output',
        });
        return;
      }
      if (!image.filename) return;
      mediaItems.push({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output',
      });
    });
  });

  return mediaItems;
};

const HistoryTab = () => {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [historyOutputs, setHistoryOutputs] = useState({});

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await getCozyHistoryList();
        setHistoryItems(data.items || []);
      } catch (error) {
        console.warn('CozyGen: failed to load history list', error);
        setHistoryItems([]);
      }
    };

    loadHistory();
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
        if (Array.isArray(item.preview_images) && item.preview_images.length > 0) return;
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
        const mediaItems = extractHistoryMedia(historyEntry);
        const previewUrls = Array.isArray(item.preview_images) ? item.preview_images : [];
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
            {mediaItems.length === 0 && previewUrls.length === 0 && (
              <p className="text-sm text-gray-400">
                {historyEntry ? 'No previews found for this prompt.' : 'Loading previews...'}
              </p>
            )}
            {previewUrls.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {previewUrls.map((url, index) => {
                  const isVideoFile = isVideo(url);
                  return (
                    <div key={`${item.id}-preview-${index}`} className="aspect-square bg-base-300 rounded-lg overflow-hidden">
                      {isVideoFile ? (
                        <LazyMedia
                          type="video"
                          src={url}
                          className="w-full h-full object-cover"
                          rootMargin="300px"
                        />
                      ) : (
                        <LazyMedia
                          type="image"
                          src={url}
                          alt="History preview"
                          className="w-full h-full object-cover"
                          rootMargin="300px"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {previewUrls.length === 0 && mediaItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {mediaItems.map((media, index) => {
                  const isVideoFile = isVideo(media.filename);
                  const isGifFile = isGif(media.filename);
                  const fullUrl = getViewUrl(media.filename, media.subfolder, media.type);
                  const thumbUrl = getThumbUrl(media.filename, media.subfolder, media.type, { w: 256, q: 45, fmt: 'webp' });
                  return (
                  <div key={`${item.id}-${index}`} className="aspect-square bg-base-300 rounded-lg overflow-hidden">
                    {isVideoFile ? (
                      <LazyMedia
                        type="video"
                        src={fullUrl}
                        className="w-full h-full object-cover"
                        rootMargin="300px"
                      />
                    ) : (
                      <LazyMedia
                        type="image"
                        src={isGifFile ? fullUrl : (thumbUrl || fullUrl)}
                        fallbackSrc={fullUrl}
                        alt="History preview"
                        className="w-full h-full object-cover"
                        rootMargin="300px"
                      />
                    )}
                  </div>
                )})}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HistoryTab;
