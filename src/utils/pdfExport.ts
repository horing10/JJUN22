import {jsPDF} from 'jspdf';
import type {
  DateRangeFilter,
  PhotoItem,
  WorkEntry,
  WorkSection,
  WorkStatus,
} from '../types/photo';
import {formatDecimalCoords, formatFileSize} from './exif';
import {formatDistance, getPhotoDateKey, type SectionProgressSummary} from './geo';

export interface PdfReportOptions {
  title: string;
  author: string;
  notes: string;
  includeMap: boolean;
  includeSections: boolean;
  includeEntries: boolean;
  includePhotos: boolean;
  mapImageDataUrl: string | null;
  activeSection: WorkSection | null;
  dateRange: DateRangeFilter;
  sections: WorkSection[];
  allSections: WorkSection[];
  photos: PhotoItem[];
  allPhotos: PhotoItem[];
  workEntries: WorkEntry[];
  sectionProgressLookup: Record<string, SectionProgressSummary>;
}

const PAGE_W = 1240;
const PAGE_H = 1754; // A4 portrait ~150 DPI
const MARGIN_X = 64;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_SAFE = 60;
const BOTTOM_SAFE = PAGE_H - 68;

const SANS_FONT =
  '"Plus Jakarta Sans", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, sans-serif';
const MONO_FONT =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const STATUS_LABELS: Record<WorkStatus, string> = {
  planned: '예정',
  in_progress: '진행중',
  completed: '완료',
};

function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

async function loadPhotoThumb(photo: PhotoItem): Promise<HTMLImageElement | null> {
  const primary = await loadImageSafe(photo.previewUrl);
  if (primary) return primary;
  if (photo.fallbackPreviewUrl) {
    return loadImageSafe(photo.fallbackPreviewUrl);
  }
  return null;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  radius = 8
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  ctx.save();
  drawRoundedRect(ctx, dx, dy, dw, dh, radius);
  ctx.clip();

  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 10
): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of para) {
      const candidate = current + ch;
      if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch === ' ' ? '' : ch;
        if (lines.length >= maxLines) break;
      } else {
        current = candidate;
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    if (lines.length >= maxLines) break;
  }

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(`${last}...`).width <= maxWidth) {
      lines[maxLines - 1] = `${last.replace(/\s+$/, '')}...`;
    } else if (last.length > 3) {
      lines[maxLines - 1] = `${last.slice(0, -3)}...`;
    }
  }
  return lines;
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function formatDateRangeLabel(range: DateRangeFilter): string {
  if (!range.startDate && !range.endDate) return '전체 기간';
  if (range.startDate && range.endDate) {
    return range.startDate === range.endDate
      ? range.startDate
      : `${range.startDate} ~ ${range.endDate}`;
  }
  if (range.startDate) return `${range.startDate} 이후`;
  return `${range.endDate} 이전`;
}

function formatTimestampNow(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

class ReportComposer {
  pages: HTMLCanvasElement[] = [];
  ctx!: CanvasRenderingContext2D;
  y = TOP_SAFE;
  private reportTitle: string;

  constructor(reportTitle: string) {
    this.reportTitle = reportTitle;
    this.startNewPage(true);
  }

  startNewPage(isCover = false) {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.pages.push(canvas);
    this.ctx = ctx;

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // Top accent rule
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(0, 0, PAGE_W, isCover ? 8 : 5);

    if (isCover) {
      this.y = 48;
    } else {
      ctx.font = `600 16px ${SANS_FONT}`;
      ctx.fillStyle = '#64748B';
      ctx.fillText('PhotoAtlas 현장 작업 보고서', MARGIN_X, 38);

      ctx.font = `500 15px ${SANS_FONT}`;
      const rightText = truncateText(ctx, this.reportTitle, 480);
      const w = ctx.measureText(rightText).width;
      ctx.fillText(rightText, PAGE_W - MARGIN_X - w, 38);

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, 52);
      ctx.lineTo(PAGE_W - MARGIN_X, 52);
      ctx.stroke();

      this.y = 76;
    }
  }

  ensureSpace(requiredHeight: number) {
    if (this.y + requiredHeight > BOTTOM_SAFE) {
      this.startNewPage(false);
    }
  }

  drawSectionHeader(title: string, badgeText?: string) {
    this.ensureSpace(64);
    const ctx = this.ctx;

    ctx.fillStyle = '#0F172A';
    ctx.font = `700 22px ${SANS_FONT}`;
    ctx.fillText(title, MARGIN_X, this.y + 22);

    if (badgeText) {
      const titleW = ctx.measureText(title).width;
      ctx.font = `600 15px ${SANS_FONT}`;
      ctx.fillStyle = '#2563EB';
      ctx.fillText(badgeText, MARGIN_X + titleW + 14, this.y + 21);
    }

    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, this.y + 34);
    ctx.lineTo(PAGE_W - MARGIN_X, this.y + 34);
    ctx.stroke();

    this.y += 48;
  }

  stampFooters() {
    const total = this.pages.length;
    const generatedAt = formatTimestampNow();
    this.pages.forEach((canvas, idx) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, PAGE_H - 54);
      ctx.lineTo(PAGE_W - MARGIN_X, PAGE_H - 54);
      ctx.stroke();

      ctx.font = `500 14px ${SANS_FONT}`;
      ctx.fillStyle = '#64748B';
      ctx.fillText(
        `PhotoAtlas GPS 현장 위치 보고서 · 출력일시 ${generatedAt}`,
        MARGIN_X,
        PAGE_H - 28
      );

      ctx.font = `600 14px ${MONO_FONT}`;
      const pageLabel = `${idx + 1} / ${total}`;
      const labelW = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, PAGE_W - MARGIN_X - labelW, PAGE_H - 28);
    });
  }
}

export async function generateWorkReportPdf(
  options: PdfReportOptions
): Promise<void> {
  const {
    title,
    author,
    notes,
    includeMap,
    includeSections,
    includeEntries,
    includePhotos,
    mapImageDataUrl,
    activeSection,
    dateRange,
    sections,
    allSections,
    photos,
    allPhotos,
    workEntries,
    sectionProgressLookup,
  } = options;

  const cleanTitle = title.trim() || '현장 작업구간 보고서';
  const composer = new ReportComposer(cleanTitle);
  const ctx = () => composer.ctx;

  const sectionLookup: Record<string, WorkSection> = {};
  for (const s of allSections) {
    sectionLookup[s.id] = s;
  }

  const photoLookup: Record<string, PhotoItem> = {};
  for (const p of allPhotos) {
    photoLookup[p.id] = p;
  }

  // 1. COVER HEADER
  {
    const c = ctx();
    c.font = `700 14px ${SANS_FONT}`;
    c.fillStyle = '#2563EB';
    c.fillText('FIELD INSPECTION & ROUTE REPORT', MARGIN_X, composer.y);
    composer.y += 14;

    c.font = `700 32px ${SANS_FONT}`;
    c.fillStyle = '#0F172A';
    c.fillText(
      truncateText(c, cleanTitle, CONTENT_W),
      MARGIN_X,
      composer.y + 30
    );
    composer.y += 46;

    const scopeParts = [
      `대상 구간: ${activeSection ? activeSection.name : '전체 작업구간'}`,
      `조회 기간: ${formatDateRangeLabel(dateRange)}`,
      author.trim() ? `작성자: ${author.trim()}` : null,
      `생성일시: ${formatTimestampNow()}`,
    ].filter(Boolean);

    c.font = `500 16px ${SANS_FONT}`;
    c.fillStyle = '#475569';
    c.fillText(
      truncateText(c, scopeParts.join('  ·  '), CONTENT_W),
      MARGIN_X,
      composer.y + 18
    );
    composer.y += 32;

    if (notes.trim()) {
      c.font = `500 15px ${SANS_FONT}`;
      const noteLines = wrapTextLines(c, notes.trim(), CONTENT_W - 36, 4);
      const boxH = noteLines.length * 22 + 24;
      drawRoundedRect(c, MARGIN_X, composer.y, CONTENT_W, boxH, 10);
      c.fillStyle = '#F8FAFC';
      c.fill();
      c.strokeStyle = '#E2E8F0';
      c.lineWidth = 1.5;
      c.stroke();

      c.fillStyle = '#334155';
      noteLines.forEach((line, idx) => {
        c.fillText(line, MARGIN_X + 18, composer.y + 28 + idx * 22);
      });
      composer.y += boxH + 16;
    }

    // KPI Strip
    const totalDistance = sections.reduce(
      (sum, s) =>
        sum + (sectionProgressLookup[s.id]?.measuredDistanceMeters || 0),
      0
    );
    const avgProgress =
      sections.length > 0
        ? Math.round(
            sections.reduce(
              (sum, s) =>
                sum + (sectionProgressLookup[s.id]?.progressPercent || 0),
              0
            ) / sections.length
          )
        : photos.length > 0
          ? Math.round(
              (photos.filter((p) => p.isChecked).length / photos.length) * 100
            )
          : 0;
    const checkedCount = photos.filter((p) => p.isChecked).length;
    const completedEntriesCount = workEntries.filter(
      (e) => e.status === 'completed'
    ).length;

    const kpis = [
      {
        label: '작업구간',
        value: `${sections.length}개`,
        sub: activeSection ? '선택 구간 필터 적용' : '기간 내 활성 구간',
      },
      {
        label: '현장 사진',
        value: `${photos.length}장`,
        sub: `확인 완료 ${checkedCount}장 · GPS ${photos.filter((p) => p.hasGps).length}장`,
      },
      {
        label: '작업 기록',
        value: `${workEntries.length}건`,
        sub: `완료 ${completedEntriesCount}건`,
      },
      {
        label: totalDistance > 0 ? '누적 경로 / 진행률' : '평균 진행률',
        value:
          totalDistance > 0
            ? `${formatDistance(totalDistance)} (${avgProgress}%)`
            : `${avgProgress}%`,
        sub: '도로 연결 및 체크 기준',
      },
    ];

    const gap = 14;
    const cardW = (CONTENT_W - gap * 3) / 4;
    const cardH = 88;
    kpis.forEach((kpi, idx) => {
      const cx = MARGIN_X + idx * (cardW + gap);
      drawRoundedRect(c, cx, composer.y, cardW, cardH, 10);
      c.fillStyle = '#F8FAFC';
      c.fill();
      c.strokeStyle = '#E2E8F0';
      c.lineWidth = 1.5;
      c.stroke();

      c.font = `600 14px ${SANS_FONT}`;
      c.fillStyle = '#64748B';
      c.fillText(kpi.label, cx + 16, composer.y + 26);

      c.font = `700 22px ${SANS_FONT}`;
      c.fillStyle = '#0F172A';
      c.fillText(
        truncateText(c, kpi.value, cardW - 32),
        cx + 16,
        composer.y + 54
      );

      c.font = `500 12px ${SANS_FONT}`;
      c.fillStyle = '#64748B';
      c.fillText(
        truncateText(c, kpi.sub, cardW - 32),
        cx + 16,
        composer.y + 74
      );
    });

    composer.y += cardH + 28;
  }

  // 2. MAP CAPTURE IMAGE
  if (includeMap && mapImageDataUrl) {
    const mapImg = await loadImageSafe(mapImageDataUrl);
    if (mapImg) {
      composer.drawSectionHeader(
        '지도 현황 캡처',
        '구간 경로 · 작업 기록 · 사진 위치'
      );

      const iw = mapImg.naturalWidth || 1200;
      const ih = mapImg.naturalHeight || 720;
      const maxMapH = 470;
      let drawW = CONTENT_W;
      let drawH = Math.round((drawW * ih) / iw);
      if (drawH > maxMapH) {
        drawH = maxMapH;
        drawW = Math.round((drawH * iw) / ih);
      }

      composer.ensureSpace(drawH + 40);
      const c = ctx();
      const mapX = MARGIN_X + Math.round((CONTENT_W - drawW) / 2);

      drawRoundedRect(c, mapX, composer.y, drawW, drawH, 12);
      c.fillStyle = '#F1F5F9';
      c.fill();
      drawCoverImage(c, mapImg, mapX, composer.y, drawW, drawH, 12);

      drawRoundedRect(c, mapX, composer.y, drawW, drawH, 12);
      c.strokeStyle = '#CBD5E1';
      c.lineWidth = 2;
      c.stroke();

      composer.y += drawH + 26;
    }
  }

  // 3. WORK SECTIONS PROGRESS SUMMARY
  if (includeSections) {
    composer.drawSectionHeader('작업구간 진행 현황', `${sections.length}개`);

    if (sections.length === 0) {
      composer.ensureSpace(56);
      const c = ctx();
      c.font = `500 16px ${SANS_FONT}`;
      c.fillStyle = '#64748B';
      c.fillText('선택된 조건에 해당하는 작업구간이 없습니다.', MARGIN_X, composer.y + 22);
      composer.y += 46;
    } else {
      for (const sec of sections) {
        const prog = sectionProgressLookup[sec.id];
        const cMeasure = ctx();
        cMeasure.font = `500 14px ${SANS_FONT}`;
        const memoLines = sec.memo
          ? wrapTextLines(cMeasure, sec.memo, CONTENT_W - 44, 2)
          : [];
        const cardH = 98 + (memoLines.length > 0 ? memoLines.length * 20 + 6 : 0);

        composer.ensureSpace(cardH + 14);
        const c = ctx();
        const cardY = composer.y;

        drawRoundedRect(c, MARGIN_X, cardY, CONTENT_W, cardH, 10);
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.strokeStyle = '#CBD5E1';
        c.lineWidth = 1.5;
        c.stroke();

        // Color stripe
        c.save();
        drawRoundedRect(c, MARGIN_X, cardY, 8, cardH, 4);
        c.fillStyle = sec.color || '#2563EB';
        c.fill();
        ctx().restore();

        // Title & status
        c.font = `700 18px ${SANS_FONT}`;
        c.fillStyle = '#0F172A';
        c.fillText(
          truncateText(c, sec.name, 560),
          MARGIN_X + 24,
          cardY + 30
        );

        const pctText = `${prog?.progressPercent ?? 0}%`;
        c.font = `700 18px ${MONO_FONT}`;
        c.fillStyle = '#0F172A';
        const pctW = c.measureText(pctText).width;
        c.fillText(pctText, PAGE_W - MARGIN_X - 20 - pctW, cardY + 30);

        // Metadata line
        const metaParts = [
          `상태: ${STATUS_LABELS[sec.status]}`,
          `기간: ${sec.startDate} ~ ${sec.endDate}`,
          prog && prog.measuredDistanceMeters > 0
            ? `거리: ${formatDistance(prog.measuredDistanceMeters)}`
            : null,
          prog
            ? `확인 사진 ${prog.checkedPhotos}/${prog.totalPhotos}장 · 작업 ${prog.completedEntries}/${prog.totalEntries}건`
            : null,
        ].filter(Boolean);

        c.font = `500 14px ${SANS_FONT}`;
        c.fillStyle = '#475569';
        c.fillText(
          truncateText(c, metaParts.join('  ·  '), CONTENT_W - 44),
          MARGIN_X + 24,
          cardY + 56
        );

        // Progress bar
        const barX = MARGIN_X + 24;
        const barY = cardY + 70;
        const barW = CONTENT_W - 44;
        drawRoundedRect(c, barX, barY, barW, 10, 5);
        c.fillStyle = '#E2E8F0';
        c.fill();

        const pctVal = Math.max(0, Math.min(100, prog?.progressPercent ?? 0));
        if (pctVal > 0) {
          const fillW = Math.max(10, Math.round((barW * pctVal) / 100));
          drawRoundedRect(c, barX, barY, fillW, 10, 5);
          c.fillStyle = sec.color || '#2563EB';
          c.fill();
        }

        if (memoLines.length > 0) {
          c.font = `500 14px ${SANS_FONT}`;
          c.fillStyle = '#64748B';
          memoLines.forEach((line, i) => {
            c.fillText(line, MARGIN_X + 24, cardY + 102 + i * 20);
          });
        }

        composer.y += cardH + 14;
      }
      composer.y += 14;
    }
  }

  // 4. WORK ENTRIES & ATTACHED PHOTOS
  if (includeEntries) {
    composer.drawSectionHeader('작업 내용 및 현장 기록', `${workEntries.length}건`);

    if (workEntries.length === 0) {
      composer.ensureSpace(56);
      const c = ctx();
      c.font = `500 16px ${SANS_FONT}`;
      c.fillStyle = '#64748B';
      c.fillText('선택된 조건에 해당하는 작업 기록이 없습니다.', MARGIN_X, composer.y + 22);
      composer.y += 46;
    } else {
      for (const entry of workEntries) {
        const sec = entry.sectionId ? sectionLookup[entry.sectionId] : undefined;
        const attachedPhotos = entry.photoIds
          .map((pid) => photoLookup[pid])
          .filter((p): p is PhotoItem => Boolean(p));

        const thumbImages = await Promise.all(
          attachedPhotos.slice(0, 4).map((p) => loadPhotoThumb(p))
        );

        const cMeasure = ctx();
        cMeasure.font = `500 15px ${SANS_FONT}`;
        const descLines = entry.description.trim()
          ? wrapTextLines(cMeasure, entry.description.trim(), CONTENT_W - 44, 4)
          : [];

        const hasThumbs = thumbImages.some(Boolean);
        const cardH =
          94 +
          (descLines.length > 0 ? descLines.length * 22 + 8 : 0) +
          (hasThumbs ? 88 : 0);

        composer.ensureSpace(cardH + 14);
        const c = ctx();
        const cardY = composer.y;

        drawRoundedRect(c, MARGIN_X, cardY, CONTENT_W, cardH, 10);
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.strokeStyle = '#CBD5E1';
        c.lineWidth = 1.5;
        c.stroke();

        // Status indicator dot
        c.beginPath();
        c.arc(MARGIN_X + 24, cardY + 26, 6, 0, Math.PI * 2);
        c.fillStyle = entry.status === 'completed' ? '#059669' : '#D97706';
        c.fill();

        // Title
        c.font = `700 18px ${SANS_FONT}`;
        c.fillStyle = '#0F172A';
        c.fillText(
          truncateText(c, entry.title, CONTENT_W - 180),
          MARGIN_X + 40,
          cardY + 32
        );

        const statusLabel = STATUS_LABELS[entry.status];
        c.font = `700 14px ${SANS_FONT}`;
        c.fillStyle = entry.status === 'completed' ? '#059669' : '#B45309';
        const statusW = c.measureText(statusLabel).width;
        c.fillText(statusLabel, PAGE_W - MARGIN_X - 20 - statusW, cardY + 31);

        // Meta + Address
        const metaParts = [
          entry.workDate,
          entry.teamName || null,
          sec ? sec.name : null,
          `첨부 사진 ${entry.photoIds.length}장`,
        ].filter(Boolean);
        c.font = `500 14px ${SANS_FONT}`;
        c.fillStyle = '#475569';
        c.fillText(
          truncateText(c, metaParts.join('  ·  '), CONTENT_W - 44),
          MARGIN_X + 22,
          cardY + 56
        );

        const addrLine = entry.location?.formattedAddress
          ? `위치: ${entry.location.formattedAddress} (${formatDecimalCoords(entry.lat, entry.lng)})`
          : `좌표: ${formatDecimalCoords(entry.lat, entry.lng)}`;
        c.font = `500 14px ${SANS_FONT}`;
        c.fillStyle = '#2563EB';
        c.fillText(
          truncateText(c, addrLine, CONTENT_W - 44),
          MARGIN_X + 22,
          cardY + 78
        );

        let innerY = cardY + 96;
        if (descLines.length > 0) {
          c.font = `500 15px ${SANS_FONT}`;
          c.fillStyle = '#1E293B';
          descLines.forEach((line, idx) => {
            c.fillText(line, MARGIN_X + 22, innerY + 12 + idx * 22);
          });
          innerY += descLines.length * 22 + 12;
        }

        if (hasThumbs) {
          let tx = MARGIN_X + 22;
          thumbImages.forEach((img) => {
            if (!img) return;
            drawCoverImage(c, img, tx, innerY, 72, 72, 6);
            drawRoundedRect(c, tx, innerY, 72, 72, 6);
            c.strokeStyle = '#CBD5E1';
            c.lineWidth = 1;
            c.stroke();
            tx += 82;
          });
        }

        composer.y += cardH + 14;
      }
      composer.y += 14;
    }
  }

  // 5. PHOTO LIST & DETAILED ADDRESS INFORMATION
  if (includePhotos) {
    composer.drawSectionHeader('사진 목록 및 주소 정보', `${photos.length}장`);

    if (photos.length === 0) {
      composer.ensureSpace(56);
      const c = ctx();
      c.font = `500 16px ${SANS_FONT}`;
      c.fillStyle = '#64748B';
      c.fillText('선택된 조건에 해당하는 사진이 없습니다.', MARGIN_X, composer.y + 22);
      composer.y += 46;
    } else {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const sec = photo.sectionId ? sectionLookup[photo.sectionId] : undefined;
        const thumbImg = await loadPhotoThumb(photo);

        const cMeasure = ctx();
        const addrText =
          photo.location?.formattedAddress ||
          photo.location?.shortAddress ||
          (photo.hasGps
            ? '주소 정보 확인되지 않음'
            : 'GPS 미포함 (지도에서 수동 지정 필요)');
        cMeasure.font = `600 16px ${SANS_FONT}`;
        const textColW = CONTENT_W - 154;
        const addrLines = wrapTextLines(cMeasure, addrText, textColW, 2);

        const rowH = Math.max(134, 86 + addrLines.length * 22);
        composer.ensureSpace(rowH + 12);

        const c = ctx();
        const rowY = composer.y;

        drawRoundedRect(c, MARGIN_X, rowY, CONTENT_W, rowH, 10);
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.strokeStyle = '#CBD5E1';
        c.lineWidth = 1.5;
        c.stroke();

        // Thumbnail box
        const thumbX = MARGIN_X + 16;
        const thumbY = rowY + 15;
        const thumbSize = 104;

        drawRoundedRect(c, thumbX, thumbY, thumbSize, thumbSize, 8);
        c.fillStyle = '#F1F5F9';
        c.fill();

        if (thumbImg) {
          drawCoverImage(c, thumbImg, thumbX, thumbY, thumbSize, thumbSize, 8);
        } else {
          c.font = `600 13px ${SANS_FONT}`;
          c.fillStyle = '#94A3B8';
          c.fillText('미리보기 없음', thumbX + 14, thumbY + 56);
        }

        drawRoundedRect(c, thumbX, thumbY, thumbSize, thumbSize, 8);
        c.strokeStyle = sec?.color || '#CBD5E1';
        c.lineWidth = sec ? 2.5 : 1.5;
        c.stroke();

        // Index badge
        drawRoundedRect(c, thumbX + 6, thumbY + 6, 26, 20, 4);
        c.fillStyle = sec?.color || '#0F172A';
        c.fill();
        c.font = `700 12px ${MONO_FONT}`;
        c.fillStyle = '#FFFFFF';
        const idxStr = String(i + 1);
        const idxW = c.measureText(idxStr).width;
        c.fillText(idxStr, thumbX + 6 + (26 - idxW) / 2, thumbY + 20);

        // Text column
        const tx = thumbX + thumbSize + 18;

        // Line 1: Filename & section & check badge
        const headerMeta = [
          sec ? `[${sec.name}]` : '[구간 미지정]',
          photo.isChecked ? '확인 완료' : '미확인',
          photo.exif.dateTimeOriginal || getPhotoDateKey(photo),
        ].join('  ·  ');
        c.font = `600 13px ${SANS_FONT}`;
        c.fillStyle = photo.isChecked ? '#059669' : '#64748B';
        c.fillText(truncateText(c, headerMeta, textColW), tx, rowY + 32);

        // Line 2-3: Address
        c.font = `700 16px ${SANS_FONT}`;
        c.fillStyle = '#0F172A';
        addrLines.forEach((line, lineIdx) => {
          c.fillText(line, tx, rowY + 58 + lineIdx * 22);
        });

        const afterAddrY = rowY + 60 + addrLines.length * 22;

        // GPS & file info
        const coordLine =
          photo.hasGps &&
          photo.lat !== undefined &&
          photo.lng !== undefined
            ? `GPS: ${formatDecimalCoords(photo.lat, photo.lng)}${
                photo.isManualLocation ? ' (수동 지정)' : ''
              }`
            : 'GPS 좌표 없음';
        c.font = `500 13px ${MONO_FONT}`;
        c.fillStyle = photo.hasGps ? '#2563EB' : '#B45309';
        c.fillText(truncateText(c, coordLine, textColW), tx, afterAddrY);

        const exifParts = [
          photo.fileName,
          formatFileSize(photo.fileSize),
          [photo.exif.make, photo.exif.model].filter(Boolean).join(' ') || null,
          photo.exif.focalLength || null,
          photo.exif.fNumber || null,
          photo.exif.iso ? `ISO ${photo.exif.iso}` : null,
        ].filter(Boolean);
        c.font = `500 13px ${SANS_FONT}`;
        c.fillStyle = '#64748B';
        c.fillText(
          truncateText(c, exifParts.join(' · '), textColW),
          tx,
          afterAddrY + 20
        );

        composer.y += rowH + 12;
      }
    }
  }

  composer.stampFooters();

  // Build jsPDF A4 Document
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title: cleanTitle,
    subject: `PhotoAtlas 현장 보고서 (${formatDateRangeLabel(dateRange)})`,
    creator: 'PhotoAtlas',
    author: author.trim() || 'PhotoAtlas 현장관리팀',
  });

  composer.pages.forEach((canvas, idx) => {
    if (idx > 0) {
      doc.addPage('a4', 'portrait');
    }
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });

  const dateSlug = new Date().toISOString().slice(0, 10);
  const scopeSlug = activeSection
    ? activeSection.name.replace(/[^\w가-힣-]+/g, '_').slice(0, 24)
    : 'all';
  doc.save(`photoatlas-report-${scopeSlug}-${dateSlug}.pdf`);
}
