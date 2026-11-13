import {X} from 'lucide-react';
import {useState} from 'react';
import type {WorkSection, WorkStatus} from '../types/photo';
import {SECTION_COLORS, toDateInputString} from '../utils/geo';

interface SectionModalProps {
  section?: WorkSection | null;
  onClose: () => void;
  onSave: (data: Omit<WorkSection, 'id' | 'createdAt'>, existingId?: string) => void;
}

export function SectionModal({section, onClose, onSave}: SectionModalProps) {
  const today = toDateInputString(Date.now());
  const [name, setName] = useState(section?.name || '');
  const [color, setColor] = useState(section?.color || SECTION_COLORS[0]);
  const [status, setStatus] = useState<WorkStatus>(section?.status || 'in_progress');
  const [startDate, setStartDate] = useState(section?.startDate || today);
  const [endDate, setEndDate] = useState(section?.endDate || today);
  const [targetDistanceKm, setTargetDistanceKm] = useState(
    section?.targetDistanceMeters ? String(section.targetDistanceMeters / 1000) : ''
  );
  const [targetPhotoCount, setTargetPhotoCount] = useState(
    section?.targetPhotoCount ? String(section.targetPhotoCount) : ''
  );
  const [memo, setMemo] = useState(section?.memo || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const parsedKm = Number(targetDistanceKm);
    const parsedCount = Number(targetPhotoCount);

    onSave(
      {
        name: trimmed,
        color,
        status,
        startDate: startDate || today,
        endDate: endDate || startDate || today,
        targetDistanceMeters:
          Number.isFinite(parsedKm) && parsedKm > 0
            ? Math.round(parsedKm * 1000)
            : undefined,
        targetPhotoCount:
          Number.isFinite(parsedCount) && parsedCount > 0
            ? Math.round(parsedCount)
            : undefined,
        memo: memo.trim() || undefined,
      },
      section?.id
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {section ? '작업구간 설정 수정' : '새 작업구간 만들기'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              작업구간 이름
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 1공구 · 종로구 사직로 구간"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              구간 표기 색상
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {SECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`색상 ${c}`}
                  className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${
                    color === c
                      ? 'ring-2 ring-offset-2 ring-slate-900 scale-110'
                      : 'hover:scale-105'
                  }`}
                  style={{backgroundColor: c}}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                시작일
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                종료일
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                목표 거리 (km, 선택)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={targetDistanceKm}
                onChange={(e) => setTargetDistanceKm(e.target.value)}
                placeholder="예: 1.5"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                목표 지점 수 (선택)
              </label>
              <input
                type="number"
                min="1"
                value={targetPhotoCount}
                onChange={(e) => setTargetPhotoCount(e.target.value)}
                placeholder="예: 10"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              진행 상태
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  {id: 'planned', label: '예정'},
                  {id: 'in_progress', label: '진행중'},
                  {id: 'completed', label: '완료'},
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatus(opt.id)}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    status === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              구간 메모
            </label>
            <textarea
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="담당 작업팀, 특이사항 등을 기록하세요"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer"
            >
              {section ? '변경사항 저장' : '구간 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
