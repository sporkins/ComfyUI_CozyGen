import React, { useEffect, useRef, useState } from 'react';
import { getViewUrl } from '../api';

const isVideoFile = (filename = '') => /\.(mp4|webm)$/i.test(filename);

const getItemLabel = (item) => item?.filename || 'Unknown';

const getItemUrl = (item) => getViewUrl(item.filename, item.subfolder, 'output');

const WIDE_ASPECT_THRESHOLD = 1.2;

const CompareDivider = ({ sliderPercent }) => (
  <div
    className="pointer-events-none absolute inset-y-0 z-20"
    style={{ left: `${sliderPercent}%`, transform: 'translateX(-50%)' }}
  >
    <div className="relative h-full w-0">
      <div className="absolute inset-y-0 -left-[2px] w-1 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
      <div className="absolute top-1/2 -left-5 -translate-y-1/2 h-10 w-10 rounded-full border-2 border-white bg-black/70 shadow-lg flex items-center justify-center">
        <div className="flex items-center gap-1 text-white">
          <span className="text-xs leading-none">◀</span>
          <span className="text-xs leading-none">▶</span>
        </div>
      </div>
    </div>
  </div>
);

const CompareLabels = ({ leftLabel, rightLabel }) => (
  <>
    <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-black/65 text-xs text-white max-w-[45%] truncate">
      {leftLabel}
    </div>
    <div className="absolute top-2 right-2 z-20 px-2 py-1 rounded bg-black/65 text-xs text-white max-w-[45%] truncate text-right">
      {rightLabel}
    </div>
  </>
);

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M6.5 4.75a1 1 0 0 1 1.54-.84l7.25 5.25a1 1 0 0 1 0 1.68l-7.25 5.25a1 1 0 0 1-1.54-.84V4.75Z" />
  </svg>
);

const PauseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M5.75 4A1.75 1.75 0 0 0 4 5.75v8.5C4 15.22 4.78 16 5.75 16h.5C7.22 16 8 15.22 8 14.25v-8.5C8 4.78 7.22 4 6.25 4h-.5Zm8 0A1.75 1.75 0 0 0 12 5.75v8.5c0 .97.78 1.75 1.75 1.75h.5c.97 0 1.75-.78 1.75-1.75v-8.5C16 4.78 15.22 4 14.25 4h-.5Z" />
  </svg>
);

const RestartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m-1.6 3.392a9 9 0 1 0 2.1 5.894" />
  </svg>
);

const ImageCompareCanvas = ({ leftUrl, rightUrl, leftLabel, rightLabel, sliderPercent, onPointerStart }) => (
  <div
    className="relative w-full aspect-video bg-base-300/40 rounded-lg overflow-hidden select-none"
    onPointerDown={onPointerStart}
  >
    <CompareLabels leftLabel={leftLabel} rightLabel={rightLabel} />
    <img
      src={rightUrl}
      alt={rightLabel}
      className="absolute inset-0 h-full w-full object-contain bg-black"
      draggable={false}
    />
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
    >
      <img
        src={leftUrl}
        alt={leftLabel}
        className="absolute inset-0 h-full w-full object-contain bg-black"
        draggable={false}
      />
    </div>
    <CompareDivider sliderPercent={sliderPercent} />
  </div>
);

const VideoCompareCanvas = ({ leftUrl, rightUrl, leftLabel, rightLabel, sliderPercent, onPointerStart }) => {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const rafRef = useRef(null);
  const syncingRef = useRef(false);
  const minDurationRef = useRef(null);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durations, setDurations] = useState({ left: null, right: null });

  const minDuration = Number.isFinite(durations.left) && Number.isFinite(durations.right)
    ? Math.min(durations.left, durations.right)
    : null;

  useEffect(() => {
    minDurationRef.current = minDuration;
  }, [minDuration]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const safeSyncTimes = (source, target) => {
    const maxDuration = minDurationRef.current;
    if (!source || !target || syncingRef.current) return;
    const sourceTime = source.currentTime || 0;
    const clampedTime = Number.isFinite(maxDuration)
      ? Math.min(sourceTime, Math.max(0, maxDuration - 0.02))
      : sourceTime;
    if (Math.abs((target.currentTime || 0) - clampedTime) < 0.05) return;
    syncingRef.current = true;
    try {
      target.currentTime = clampedTime;
    } catch (error) {
      // Ignore seek sync failures for partially loaded media.
    } finally {
      syncingRef.current = false;
    }
  };

  const syncPlaybackState = async (fromRef, toRef, shouldPlay) => {
    const source = fromRef.current;
    const target = toRef.current;
    if (!source || !target) return;
    safeSyncTimes(source, target);
    target.playbackRate = source.playbackRate || 1;
    if (shouldPlay) {
      try {
        await target.play();
      } catch (error) {
        // Browser autoplay / user gesture restrictions can block this.
      }
    } else {
      target.pause();
    }
  };

  const handleVideoLoaded = (side, event) => {
    const duration = event.currentTarget.duration;
    setDurations((prev) => ({
      ...prev,
      [side]: Number.isFinite(duration) ? duration : null,
    }));
  };

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) {
      return undefined;
    }

    const onLeftPlay = () => {
      setIsPlaying(true);
      syncPlaybackState(leftRef, rightRef, true);
    };
    const onRightPlay = () => {
      setIsPlaying(true);
      syncPlaybackState(rightRef, leftRef, true);
    };
    const onLeftPause = () => {
      setIsPlaying(false);
      syncPlaybackState(leftRef, rightRef, false);
    };
    const onRightPause = () => {
      setIsPlaying(false);
      syncPlaybackState(rightRef, leftRef, false);
    };
    const onLeftSeeked = () => safeSyncTimes(leftRef.current, rightRef.current);
    const onRightSeeked = () => safeSyncTimes(rightRef.current, leftRef.current);
    const onLeftRateChange = () => {
      if (rightRef.current) {
        rightRef.current.playbackRate = leftRef.current?.playbackRate || 1;
      }
    };
    const onRightRateChange = () => {
      if (leftRef.current) {
        leftRef.current.playbackRate = rightRef.current?.playbackRate || 1;
      }
    };

    left.addEventListener('play', onLeftPlay);
    right.addEventListener('play', onRightPlay);
    left.addEventListener('pause', onLeftPause);
    right.addEventListener('pause', onRightPause);
    left.addEventListener('seeked', onLeftSeeked);
    right.addEventListener('seeked', onRightSeeked);
    left.addEventListener('ratechange', onLeftRateChange);
    right.addEventListener('ratechange', onRightRateChange);

    return () => {
      left.removeEventListener('play', onLeftPlay);
      right.removeEventListener('play', onRightPlay);
      left.removeEventListener('pause', onLeftPause);
      right.removeEventListener('pause', onRightPause);
      left.removeEventListener('seeked', onLeftSeeked);
      right.removeEventListener('seeked', onRightSeeked);
      left.removeEventListener('ratechange', onLeftRateChange);
      right.removeEventListener('ratechange', onRightRateChange);
    };
  }, []);

  useEffect(() => {
    const step = () => {
      const left = leftRef.current;
      const right = rightRef.current;
      const maxDuration = minDurationRef.current;
      if (left && right && Number.isFinite(maxDuration)) {
        const currentMaxTime = Math.max(left.currentTime || 0, right.currentTime || 0);
        if (currentMaxTime >= Math.max(0, maxDuration - 0.04)) {
          syncingRef.current = true;
          try {
            left.currentTime = 0;
            right.currentTime = 0;
          } catch (error) {
            // Ignore transient seek errors while sources are loading.
          } finally {
            syncingRef.current = false;
          }
          if (isPlayingRef.current) {
            left.play().catch(() => {});
            right.play().catch(() => {});
          }
        }
      }
      rafRef.current = window.requestAnimationFrame(step);
    };

    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    setIsPlaying(false);
    left.pause();
    right.pause();
    left.currentTime = 0;
    right.currentTime = 0;
  }, [leftUrl, rightUrl]);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right || !Number.isFinite(minDuration)) return;
    left.play().catch(() => {});
    right.play().catch(() => {});
    setIsPlaying(true);
  }, [leftUrl, rightUrl, minDuration]);

  const togglePlayPause = async () => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    if (left.paused && right.paused) {
      try {
        await left.play();
      } catch (error) {
        // User gesture should normally allow this via button click.
      }
      right.play().catch(() => {});
      setIsPlaying(true);
      return;
    }
    left.pause();
    right.pause();
    setIsPlaying(false);
  };

  const restart = () => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    left.currentTime = 0;
    right.currentTime = 0;
    if (isPlayingRef.current) {
      left.play().catch(() => {});
      right.play().catch(() => {});
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="relative w-full aspect-video bg-black rounded-lg overflow-hidden select-none"
        onPointerDown={onPointerStart}
      >
        <CompareLabels leftLabel={leftLabel} rightLabel={rightLabel} />
        <video
          ref={rightRef}
          src={rightUrl}
          className="absolute inset-0 h-full w-full object-contain"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => handleVideoLoaded('right', event)}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
        >
          <video
            ref={leftRef}
            src={leftUrl}
            className="absolute inset-0 h-full w-full object-contain"
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => handleVideoLoaded('left', event)}
          />
        </div>
        <CompareDivider sliderPercent={sliderPercent} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn btn-sm ${isPlaying ? 'btn-warning' : 'btn-accent'}`} onClick={togglePlayPause}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={restart}>
          <RestartIcon />
          <span>Restart</span>
        </button>
        <span className="text-xs text-gray-400">
          {Number.isFinite(minDuration)
            ? `Loops at shortest video (${minDuration.toFixed(2)}s)`
            : 'Loading video metadata...'}
        </span>
      </div>
    </div>
  );
};

const TopPreviewMedia = ({
  item,
  onAspectKnown,
  videoRef,
  onVideoPlay,
  onVideoPause,
}) => {
  const url = getItemUrl(item);
  const filename = item?.filename || '';
  const isVideo = isVideoFile(filename);

  if (isVideo) {
    return (
      <video
        ref={videoRef}
        src={url}
        controls
        muted
        preload="metadata"
        playsInline
        className="w-full max-h-[28rem] rounded-lg bg-black object-contain"
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) {
            onAspectKnown(videoWidth / videoHeight);
          }
        }}
        onPlay={onVideoPlay}
        onPause={onVideoPause}
      />
    );
  }

  return (
    <img
      src={url}
      alt={filename}
      className="w-full max-h-[28rem] rounded-lg bg-black object-contain"
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
          onAspectKnown(naturalWidth / naturalHeight);
        }
      }}
    />
  );
};

const MediaComparePanel = ({ leftItem, rightItem }) => {
  const [sliderPercent, setSliderPercent] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [leftAspect, setLeftAspect] = useState(null);
  const [rightAspect, setRightAspect] = useState(null);
  const [topVideosPlaying, setTopVideosPlaying] = useState(false);
  const sliderAreaRef = useRef(null);
  const topLeftVideoRef = useRef(null);
  const topRightVideoRef = useRef(null);

  const leftUrl = getItemUrl(leftItem);
  const rightUrl = getItemUrl(rightItem);
  const leftLabel = getItemLabel(leftItem);
  const rightLabel = getItemLabel(rightItem);
  const isVideoCompare = isVideoFile(leftItem?.filename) && isVideoFile(rightItem?.filename);

  useEffect(() => {
    setSliderPercent(50);
    setLeftAspect(null);
    setRightAspect(null);
    setTopVideosPlaying(false);
  }, [leftItem?.filename, leftItem?.subfolder, rightItem?.filename, rightItem?.subfolder]);

  const syncTopVideoTimes = (sourceRef, targetRef) => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!source || !target) return;
    const time = source.currentTime || 0;
    if (Math.abs((target.currentTime || 0) - time) < 0.05) return;
    try {
      target.currentTime = time;
    } catch (error) {
      // Ignore sync attempts before metadata is fully available.
    }
  };

  const playTopVideos = async (sourceRef, targetRef) => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!source || !target) return;
    syncTopVideoTimes(sourceRef, targetRef);
    try {
      await source.play();
    } catch (error) {
      // User gesture may be required; the button click path should usually allow playback.
    }
    target.play().catch(() => {});
    setTopVideosPlaying(true);
  };

  const pauseTopVideos = (firstRef, secondRef) => {
    firstRef.current?.pause();
    secondRef.current?.pause();
    setTopVideosPlaying(false);
  };

  const toggleTopVideosPlayPause = async () => {
    const leftVideo = topLeftVideoRef.current;
    const rightVideo = topRightVideoRef.current;
    if (!leftVideo || !rightVideo) return;

    if (leftVideo.paused && rightVideo.paused) {
      await playTopVideos(topLeftVideoRef, topRightVideoRef);
      return;
    }

    pauseTopVideos(topLeftVideoRef, topRightVideoRef);
  };

  const restartTopVideos = async () => {
    const leftVideo = topLeftVideoRef.current;
    const rightVideo = topRightVideoRef.current;
    if (!leftVideo || !rightVideo) return;
    try {
      leftVideo.currentTime = 0;
      rightVideo.currentTime = 0;
    } catch (error) {
      return;
    }
    if (topVideosPlaying) {
      await playTopVideos(topLeftVideoRef, topRightVideoRef);
    }
  };

  useEffect(() => {
    if (!isDragging) return undefined;

    const updateFromPointer = (event) => {
      const rect = sliderAreaRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const raw = ((event.clientX - rect.left) / rect.width) * 100;
      setSliderPercent(Math.min(100, Math.max(0, raw)));
    };

    const handlePointerMove = (event) => updateFromPointer(event);
    const handlePointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging]);

  const beginDrag = (event) => {
    const area = sliderAreaRef.current;
    if (!area) return;
    setIsDragging(true);
    const rect = area.getBoundingClientRect();
    const raw = ((event.clientX - rect.left) / rect.width) * 100;
    setSliderPercent(Math.min(100, Math.max(0, raw)));
  };

  const stackTopPreviews = (leftAspect && leftAspect > WIDE_ASPECT_THRESHOLD)
    || (rightAspect && rightAspect > WIDE_ASPECT_THRESHOLD);

  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Compare Media</h2>
          <p className="text-xs text-gray-400">
            Drag the divider to scrub between the two {isVideoCompare ? 'videos' : 'images'}.
          </p>
        </div>
        <div className="text-xs text-gray-400">
          {leftLabel} vs {rightLabel}
        </div>
      </div>

      {isVideoCompare && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`btn btn-sm ${topVideosPlaying ? 'btn-warning' : 'btn-accent'}`}
            onClick={toggleTopVideosPlayPause}
          >
            {topVideosPlaying ? <PauseIcon /> : <PlayIcon />}
            <span>{topVideosPlaying ? 'Pause Top Videos' : 'Play Top Videos'}</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={restartTopVideos}
          >
            <RestartIcon />
            <span>Restart Top Videos</span>
          </button>
          <span className="text-xs text-gray-400">
            Shared controls for the two top preview videos.
          </span>
        </div>
      )}

      <div className={`grid gap-3 ${stackTopPreviews ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
        <div className="space-y-2">
          <p className="text-xs text-gray-400 truncate">{leftLabel}</p>
          <TopPreviewMedia
            item={leftItem}
            onAspectKnown={setLeftAspect}
            videoRef={topLeftVideoRef}
            onVideoPlay={() => {
              setTopVideosPlaying(true);
              syncTopVideoTimes(topLeftVideoRef, topRightVideoRef);
            }}
            onVideoPause={() => {
              const rightVideo = topRightVideoRef.current;
              if (!rightVideo || rightVideo.paused) {
                setTopVideosPlaying(false);
              }
            }}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs text-gray-400 truncate">{rightLabel}</p>
          <TopPreviewMedia
            item={rightItem}
            onAspectKnown={setRightAspect}
            videoRef={topRightVideoRef}
            onVideoPlay={() => {
              setTopVideosPlaying(true);
              syncTopVideoTimes(topRightVideoRef, topLeftVideoRef);
            }}
            onVideoPause={() => {
              const leftVideo = topLeftVideoRef.current;
              if (!leftVideo || leftVideo.paused) {
                setTopVideosPlaying(false);
              }
            }}
          />
        </div>
      </div>

      <div ref={sliderAreaRef}>
        {isVideoCompare ? (
          <VideoCompareCanvas
            leftUrl={leftUrl}
            rightUrl={rightUrl}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            sliderPercent={sliderPercent}
            onPointerStart={beginDrag}
          />
        ) : (
          <ImageCompareCanvas
            leftUrl={leftUrl}
            rightUrl={rightUrl}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            sliderPercent={sliderPercent}
            onPointerStart={beginDrag}
          />
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{leftLabel}</span>
          <span>{Math.round(sliderPercent)}%</span>
          <span>{rightLabel}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={sliderPercent}
          onChange={(event) => setSliderPercent(Number(event.target.value))}
          className="range range-sm range-accent w-full"
          aria-label="Compare slider position"
        />
      </div>
    </div>
  );
};

export default MediaComparePanel;
