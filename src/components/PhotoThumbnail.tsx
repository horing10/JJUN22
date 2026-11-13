import {Camera} from 'lucide-react';
import {useEffect, useState} from 'react';

interface PhotoThumbnailProps {
  src: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
}

export function PhotoThumbnail({
  src,
  fallbackSrc,
  alt,
  className = '',
}: PhotoThumbnailProps) {
  const [activeSrc, setActiveSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setActiveSrc(src);
    setFailed(false);
  }, [src]);

  if (failed || !activeSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-400 ${className}`}
        aria-label={alt}
      >
        <Camera className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={activeSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (fallbackSrc && activeSrc !== fallbackSrc) {
          setActiveSrc(fallbackSrc);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
