'use client';

import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { ssoFetch } from '@/lib/sso/frontend/app-fetch';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> & { src: string };
type LoadedImage = { source: string; url?: string; failed?: boolean };

/** Protected image tags cannot send Bearer headers; display bytes fetched by the SSO transport. */
export default function SsoImage({ src, alt = '', loading = 'lazy', ...props }: Props) {
  const element = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const active = loading !== 'lazy' || visible || typeof IntersectionObserver === 'undefined';

  useEffect(() => {
    if (loading !== 'lazy' || typeof IntersectionObserver === 'undefined' || !element.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      // Release offscreen blobs instead of retaining hundreds of full-size images.
      if (!entry.isIntersecting) setLoaded(null);
    }, { rootMargin: '300px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let disposed = false;
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await ssoFetch(src, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) {
          throw new Error('图片加载失败');
        }
        const blob = await response.blob();
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ source: src, url: objectUrl });
      } catch {
        if (!disposed) setLoaded({ source: src, failed: true });
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, active]);

  const current = active && loaded?.source === src ? loaded : null;
  return (
    // Blob URLs already contain the authenticated bytes; Next's image optimizer cannot fetch them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      ref={element}
      src={current?.url}
      alt={current?.failed ? `图片加载失败${alt ? `：${alt}` : ''}` : alt}
      loading={loading}
      onError={() => setLoaded({ source: src, failed: true })}
    />
  );
}
