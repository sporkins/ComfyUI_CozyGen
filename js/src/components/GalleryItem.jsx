import React from 'react';
import LazyMedia from './LazyMedia';
import { getThumbUrl, getViewUrl } from '../api';

const isVideo = (filename) => /\.(mp4|webm)$/i.test(filename);
const isGif = (filename) => /\.(gif)$/i.test(filename);
const isAudio = (filename) => /\.(mp3|wav|flac)$/i.test(filename);

const GalleryItem = ({
    item,
    onSelect,
    onToggleCompare,
    isSelectedForCompare = false,
    compareButtonDisabled = false,
}) => {
    const isDirectory = item.type === 'directory';
    const fileUrl = isDirectory ? '' : getViewUrl(item.filename, item.subfolder, 'output');
    const thumbUrl = isDirectory ? '' : getThumbUrl(item.filename, item.subfolder, 'output', { w: 384, q: 45, fmt: 'webp' });
    const isComparableMedia = !isDirectory && !isAudio(item.filename);

    const renderContent = () => {
        if (isDirectory) {
            return (
                <div className="flex flex-col items-center justify-center h-full bg-base-300/50">
                    <svg className="w-16 h-16 text-gray-500 group-hover:text-accent transition-colors" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                </div>
            );
        } else if (isVideo(item.filename)) {
            return (
                <LazyMedia
                    type="video"
                    src={fileUrl}
                    className="w-full h-full object-cover"
                    rootMargin="300px"
                />
            );
        } else if (isAudio(item.filename)) {
            return (
                <div className="flex flex-col items-center justify-center h-full bg-base-300/50">
                    <svg className="w-16 h-16 text-gray-500 group-hover:text-accent transition-colors" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>
                </div>
            );
        } else {
            const isAnimatedGif = isGif(item.filename);
            return (
                <LazyMedia
                    type="image"
                    src={isAnimatedGif ? fileUrl : (thumbUrl || fileUrl)}
                    fallbackSrc={fileUrl}
                    alt={item.filename}
                    className="w-full h-full object-cover"
                    rootMargin="300px"
                />
            );
        }
    };

    return (
        <div 
            className={`bg-base-200 rounded-lg shadow-lg overflow-hidden cursor-pointer group transform hover:-translate-y-1 transition-all duration-300 ${isSelectedForCompare ? 'ring-2 ring-accent' : ''}`}
            onClick={() => onSelect(item)}
        >
            <div className="relative w-full h-48">
                {renderContent()}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                {isComparableMedia && typeof onToggleCompare === 'function' && (
                    <label
                        className={`absolute top-2 right-2 z-10 flex items-center gap-2 rounded-full px-2 py-1 text-xs transition-colors shadow ${
                            isSelectedForCompare
                                ? 'bg-base-100/95 text-white ring-1 ring-accent'
                                : 'bg-black/75 text-white hover:bg-black/90'
                        } ${compareButtonDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        onClick={(event) => event.stopPropagation()}
                        title={isSelectedForCompare ? 'Remove from compare' : 'Add to compare'}
                    >
                        <input
                            type="checkbox"
                            checked={isSelectedForCompare}
                            disabled={compareButtonDisabled}
                            onChange={() => onToggleCompare(item)}
                            className="checkbox checkbox-xs checkbox-accent"
                            aria-label={`${isSelectedForCompare ? 'Remove' : 'Add'} ${item.filename} ${isSelectedForCompare ? 'from' : 'to'} compare`}
                        />
                        <span className="leading-none">Compare</span>
                    </label>
                )}
            </div>
            <p className="p-2 text-sm text-white truncate">{item.filename}</p>
        </div>
    );
}

export default GalleryItem;
