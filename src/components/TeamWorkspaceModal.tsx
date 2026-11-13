import type {User} from 'firebase/auth';
import {signInWithPopup, signOut} from 'firebase/auth';
import {
  Check,
  Copy,
  Link2,
  LogIn,
  LogOut,
  Plus,
  Share2,
  Users,
  X,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import {auth, googleProvider} from '../firebase';
import {
  createSharedWorkspace,
  getSafeDisplayName,
  joinSharedWorkspace,
  listUserSavedWorkspaces,
  type SavedWorkspaceLink,
  type WorkspaceMemberInfo,
  type WorkspaceSummary,
} from '../utils/sharedWorkspace';

interface TeamWorkspaceModalProps {
  currentUser: User | null;
  activeWorkspace: WorkspaceSummary | null;
  members: WorkspaceMemberInfo[];
  hasLocalData: boolean;
  isMigrating: boolean;
  onClose: () => void;
  onSelectWorkspace: (ws: WorkspaceSummary, migrateLocal?: boolean) => Promise<void>;
  onDisconnectWorkspace: () => void;
  onMigrateLocalToActive: () => Promise<void>;
}

function extractWorkspaceCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('?ws=')) {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://dummy.local/${trimmed.replace(/^\/+/, '')}`);
      const ws = url.searchParams.get('ws');
      if (ws) return ws.trim();
    }
  } catch {
    // Fall through to raw input
  }
  return trimmed;
}

export function TeamWorkspaceModal({
  currentUser,
  activeWorkspace,
  members,
  hasLocalData,
  isMigrating,
  onClose,
  onSelectWorkspace,
  onDisconnectWorkspace,
  onMigrateLocalToActive,
}: TeamWorkspaceModalProps) {
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspaceLink[]>([]);
  const [workspaceNameInput, setWorkspaceNameInput] = useState('원아공영 현장 작업방');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [migrateLocalOnCreate, setMigrateLocalOnCreate] = useState(hasLocalData);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setSavedWorkspaces([]);
      return;
    }
    let active = true;
    listUserSavedWorkspaces(currentUser)
      .then((list) => {
        if (active) setSavedWorkspaces(list);
      })
      .catch(() => {
        // Ignore initial load error
      });
    return () => {
      active = false;
    };
  }, [currentUser, activeWorkspace?.workspaceId]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as {code?: string})?.code || '';
      if (code === 'auth/unauthorized-domain') {
        setErrorMsg(
          `현재 접속 도메인(${window.location.hostname})이 Firebase Authentication 승인 도메인에 등록되어 있지 않습니다. Firebase 콘솔 → Authentication → Settings → 승인된 도메인에 추가한 뒤 다시 시도해 주세요.`
        );
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg('브라우저 팝업 차단이 활성화되어 있습니다. 팝업을 허용한 뒤 다시 시도해 주세요.');
      } else if (code !== 'auth/popup-closed-by-user') {
        setErrorMsg(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    try {
      onDisconnectWorkspace();
      await signOut(auth);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setErrorMsg(null);
    setIsBusy(true);
    try {
      const ws = await createSharedWorkspace(currentUser, workspaceNameInput);
      await onSelectWorkspace(ws, migrateLocalOnCreate && hasLocalData);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '공유 작업공간 생성에 실패했습니다.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoin = async (rawCode: string) => {
    if (!currentUser) return;
    const code = extractWorkspaceCode(rawCode);
    if (!code) {
      setErrorMsg('참여할 작업공간 코드 또는 초대 링크를 입력해 주세요.');
      return;
    }
    setErrorMsg(null);
    setIsBusy(true);
    try {
      const ws = await joinSharedWorkspace(currentUser, code);
      await onSelectWorkspace(ws, false);
      setJoinCodeInput('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '작업공간 참여에 실패했습니다.');
    } finally {
      setIsBusy(false);
    }
  };

  const copyText = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  const inviteUrl = activeWorkspace
    ? `${window.location.origin}/?ws=${encodeURIComponent(activeWorkspace.workspaceId)}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              팀 실시간 공유 작업공간
            </h2>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {!currentUser ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/80 space-y-2">
                <p className="text-sm font-semibold text-slate-900">
                  여러 사람이 함께 업로드하고 실시간으로 확인하세요
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Google 계정으로 로그인한 뒤 공유 작업공간을 만들거나 초대 링크로 참여하면,
                  팀원들이 각자 스마트폰·PC에서 올린 현장 사진과 작업구간, 진행 상태를 즉시 함께 볼 수 있습니다.
                </p>
              </div>

              <button
                type="button"
                disabled={isBusy}
                onClick={handleGoogleSignIn}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                {isBusy ? '로그인 확인 중...' : 'Google 계정으로 로그인'}
              </button>
            </div>
          ) : (
            <>
              {/* Logged-in Account Strip */}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {getSafeDisplayName(currentUser).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {getSafeDisplayName(currentUser)}
                    </p>
                    <p className="text-[11px] text-emerald-700">팀 공유 로그인 연결됨</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  로그아웃
                </button>
              </div>

              {/* Active Connected Workspace */}
              {activeWorkspace && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-semibold text-blue-700">
                        현재 실시간 동기화 중
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        {activeWorkspace.name}
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5 font-mono">
                        작업방 코드: {activeWorkspace.workspaceId}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(activeWorkspace.workspaceId, 'code')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-blue-200 hover:bg-blue-100/60 text-xs font-medium text-blue-700 cursor-pointer shrink-0"
                    >
                      {copiedType === 'code' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedType === 'code' ? '복사됨' : '코드 복사'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {members.map((m) => (
                      <span
                        key={m.uid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] text-slate-700"
                      >
                        <span>{m.displayName}</span>
                        {m.role === 'owner' && (
                          <span className="text-[10px] text-blue-600 font-semibold">방장</span>
                        )}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => copyText(inviteUrl, 'link')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      {copiedType === 'link' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                      {copiedType === 'link'
                        ? '팀원 초대 링크 복사됨'
                        : '팀원 초대 링크 복사'}
                    </button>

                    <button
                      type="button"
                      onClick={onDisconnectWorkspace}
                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      로컬 모드로 전환
                    </button>
                  </div>

                  {hasLocalData && (
                    <button
                      type="button"
                      disabled={isMigrating}
                      onClick={() => void onMigrateLocalToActive()}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-blue-200 hover:bg-blue-50 text-xs font-medium text-blue-700 cursor-pointer disabled:opacity-60"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isMigrating
                        ? '로컬 자료를 공유방에 올리는 중...'
                        : '이 기기에 저장돼 있던 사진·구간도 이 공유방에 올리기'}
                    </button>
                  )}
                </div>
              )}

              {/* Create New Shared Workspace */}
              <form
                onSubmit={handleCreate}
                className="p-4 rounded-xl border border-slate-200 space-y-3"
              >
                <p className="text-xs font-bold text-slate-900">
                  새 공유 작업공간 만들기
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={workspaceNameInput}
                    onChange={(e) => setWorkspaceNameInput(e.target.value)}
                    placeholder="예: 금천구 도로보수 1팀"
                    maxLength={80}
                    className="flex-1 min-w-0 px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={isBusy || isMigrating}
                    className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    만들기
                  </button>
                </div>

                {hasLocalData && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={migrateLocalOnCreate}
                      onChange={(e) => setMigrateLocalOnCreate(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    현재 기기에 열려 있는 작업구간·사진·기록도 함께 올리기
                  </label>
                )}
              </form>

              {/* Join By Workspace Code or Link */}
              <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-900">
                  초대 코드 또는 링크로 작업방 참여하기
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value)}
                      placeholder="작업방 코드(team-xxxxxx) 또는 초대 URL 붙여넣기"
                      className="w-full pl-8 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isBusy || !joinCodeInput.trim()}
                    onClick={() => void handleJoin(joinCodeInput)}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    참여
                  </button>
                </div>
              </div>

              {/* Previously Saved Workspaces */}
              {savedWorkspaces.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-600">
                    내가 참여한 공유 작업공간
                  </p>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {savedWorkspaces.map((item) => {
                      const isCurrent =
                        activeWorkspace?.workspaceId === item.workspaceId;
                      return (
                        <div
                          key={item.workspaceId}
                          className={`px-3.5 py-2.5 flex items-center justify-between gap-2 ${
                            isCurrent ? 'bg-blue-50/70' : 'bg-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {item.workspaceName}
                            </p>
                            <p className="text-[11px] font-mono text-slate-400">
                              {item.workspaceId}
                            </p>
                          </div>
                          {isCurrent ? (
                            <span className="text-[11px] font-semibold text-blue-700 shrink-0">
                              연결됨
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleJoin(item.workspaceId)}
                              className="px-2.5 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer shrink-0"
                            >
                              열기
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
