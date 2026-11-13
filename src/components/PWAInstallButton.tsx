import {Download, Share, Smartphone, X} from 'lucide-react';
import {useState} from 'react';
import {usePWAInstall} from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-4 h-4 text-blue-600" />
        <span className="hidden sm:inline">앱 설치</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="w-4 h-4 text-blue-600" />
          <span className="hidden sm:inline">홈 화면 추가</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-xs p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/apple-touch-icon.png"
                    alt="원아공영 앱 아이콘"
                    className="w-10 h-10 rounded-lg border border-slate-200 shrink-0"
                  />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      iPhone / iPad 홈 화면에 추가
                    </h3>
                    <p className="text-xs text-slate-500">
                      주소창 없이 전체 화면 앱으로 실행됩니다
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="닫기"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ol className="mt-4 space-y-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-mono text-[11px] font-semibold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="leading-relaxed">
                    Safari 상단 또는 하단의{' '}
                    <strong className="inline-flex items-center gap-1 text-slate-900">
                      공유 <Share className="w-3.5 h-3.5 text-blue-600 inline" />
                    </strong>{' '}
                    버튼을 누르세요.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-mono text-[11px] font-semibold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span className="leading-relaxed">
                    메뉴를 내려{' '}
                    <strong className="text-slate-900">홈 화면에 추가</strong>를
                    선택한 뒤 <strong className="text-slate-900">추가</strong>를
                    누르세요.
                  </span>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-slate-900 hover:bg-slate-800 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
              >
                확인
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
