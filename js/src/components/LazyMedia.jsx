import React, { useEffect, useRef, useState } from 'react';

const useInView = ({ rootMargin = '200px', threshold = 0.1 } = {}) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin, threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return { ref, inView };
};

const LazyMedia = ({
  src,
  alt = '',
  type = 'image',
  className = '',
  rootMargin,
  threshold,
  fallbackSrc,
}) => {
  const { ref, inView } = useInView({ rootMargin, threshold });
  const [shouldLoad, setShouldLoad] = useState(false);
  const videoRef = useRef(null);
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    if (inView) {
      setShouldLoad(true);
    }
  }, [inView]);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  useEffect(() => {
    if (type !== 'video' || !videoRef.current) return;
    if (inView) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [inView, type]);

  const placeholder = (
    <div className="w-full h-full bg-base-300/50 animate-pulse" />
  );

  return (
    <div ref={ref} className="w-full h-full">
      {!shouldLoad && placeholder}
      {shouldLoad && type === 'video' && (
        <video
          ref={videoRef}
          src={src}
          autoPlay={inView}
          muted
          loop
          playsInline
          preload={inView ? 'metadata' : 'none'}
          className={className}
        />
      )}
      {shouldLoad && type !== 'video' && (
        <img
          src={currentSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className={className}
          onError={() => {
            if (fallbackSrc && currentSrc !== fallbackSrc) {
              setCurrentSrc(fallbackSrc);
            }
          }}
        />
      )}
    </div>
  );
};

export default LazyMedia;
