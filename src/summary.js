import { readFile } from "node:fs/promises";

function valueOrDash(value) {
  return value == null || value === "" ? "-" : String(value);
}

function kst(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

let report = {};
try {
  report = JSON.parse(await readFile(process.env.CGV_WATCH_REPORT, "utf8"));
} catch {
  report = { status: "failed", error: "실행 보고서가 생성되지 않았습니다." };
}

const scheduledTime = Number(process.env.TRIGGER_SCHEDULED_TIME_MS);
const triggerDelaySeconds = Number.isFinite(scheduledTime) && scheduledTime > 0 && report.startedAt
  ? Math.max(0, Math.round((new Date(report.startedAt).getTime() - scheduledTime) / 1_000))
  : null;
const formatLabel = Array.isArray(report.formats) && report.formats.length > 0
  ? report.formats.join(", ")
  : "전체 형식";

console.log([
  "## CGV Open Watch 실행 결과",
  "",
  `- 상태: ${valueOrDash(report.status)}`,
  `- 호출 경로: ${valueOrDash(process.env.TRIGGER_SOURCE || process.env.GITHUB_EVENT_NAME)}`,
  `- 예약 시각: ${scheduledTime > 0 ? kst(scheduledTime) : "-"}`,
  `- 감시 시작: ${kst(report.startedAt)}`,
  `- 트리거 지연: ${triggerDelaySeconds == null ? "-" : `${triggerDelaySeconds}초`}`,
  `- 조회 소요: ${report.durationMs == null ? "-" : `${Math.round(report.durationMs / 1_000)}초`}`,
  `- 영화: ${valueOrDash(report.movieTitle)}`,
  `- 극장: ${Array.isArray(report.theatres) ? report.theatres.join(", ") : "-"}`,
  `- 형식: ${formatLabel}`,
  `- 전체/예매 가능: ${valueOrDash(report.allScheduleCount)} / ${valueOrDash(report.targetScheduleCount)}`,
  `- 새 예매 오픈: ${valueOrDash(report.newlyBookableCount)}개`,
  `- 전송 완료/대기: ${valueOrDash(report.notificationDeliveredCount)}개 / ${valueOrDash(report.pendingCount)}개`,
  `- Discord 메시지: ${valueOrDash(report.notificationMessageCount)}건`,
  report.testNotification ? `- 테스트 알림: ${report.testNotification}` : null,
  report.error ? `- 오류: ${report.error}` : null,
].filter(Boolean).join("\n"));
