import {RefreshCw} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useRegisterSW} from 'virtual:pwa-register/react';

export function PWAUpdatePrompt() {
  const [isUpdating, setIsUpdating] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registrationRef.current = registration;
      }
    },
  });

  useEffect(() => {
    const checkUpdate = () => {
      if (navigator.onLine && registrationRef.current) {
        void registrationRef.current.update();
      }
    };

    // Check for newly deployed PWA versions periodically, when returning to foreground, and when online
    const interval = window.setInterval(checkUpdate, 30 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkUpdate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', checkUpdate);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', checkUpdate);
    };
  }, []);

  useEffect(() => {
    if (!needRefresh) {
      setIsUpdating(false);
    }
  }, [needRefresh]);

  if (!needRefresh) {
    return null;
  }

  const handleConfirmUpdate = async () => {
    setIsUpdating(true);
    try {
      await updateServiceWorker(true);
    } catch {
      window.location.reload();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-update-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <h3
              id="pwa-update-title"
              className="text-sm font-semibold text-slate-900"
            >
              새로운 버전이 있습니다. 업데이트하시겠습니까?
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              최신 버전으로 갱신해도 저장된 작업구간·사진·기록 데이터와 로그인 상태는 그대로 유지됩니다.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => setNeedRefresh(false)}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            나중에
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => void handleConfirmUpdate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white transition-colors cursor-pointer disabled:bg-blue-400"
          >
            {isUpdating ? '업데이트 중...' : '업데이트'}
          </button>
        </div>
      </div>
    </div>
  );
}
