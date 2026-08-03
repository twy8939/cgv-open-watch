# CGV Open Watch

CGV 공개 예매 화면에서 지정한 영화의 새 회차가 열리면 Discord로 알리는 범용 감시기입니다. 영화, 극장, 상영 형식을 설정할 수 있으며 기본 예시는 `스파이더맨-브랜드 뉴 데이`와 CGV 용산아이파크몰입니다.

## 운영 방식

- Cloudflare Cron이 평소에는 5분마다 GitHub Actions 감시 작업을 호출합니다. 특정 상영일 5일 전부터는 자동으로 2분 간격으로 전환합니다.
- 실제 CGV 조회는 GitHub Actions의 Chrome이 담당하고, Cloudflare는 설정과 자동 호출만 담당합니다.
- CGV 지점 공개 화면을 Chrome으로 열고, 화면이 사용하는 공식 읽기 전용 일정 응답을 확인합니다.
- 특정 날짜 규칙은 CGV 날짜 목록을 먼저 확인하고 지정 날짜가 나타났을 때 그 날짜의 일정만 조회합니다.
- 로그인, CAPTCHA, 유료 기능, 접근 제한을 우회하지 않습니다.
- 발견한 회차와 아직 보내지 못한 알림은 `state/notifications.json`에 저장해 재시작 후에도 이어서 처리합니다.
- 같은 날짜에 함께 열린 회차는 Discord 글자 제한 안에서 묶어 알림 폭주를 줄입니다.
- CGV의 일시적 서버 오류와 Discord 요청 제한은 제한된 횟수만 자동 재시도합니다.
- 새 회차를 먼저 상태 파일에 커밋하고 Discord 전송에 성공한 회차만 대기열에서 제거합니다.
- 상태 파일은 새 회차 발견, 전송 완료, 오래된 기록 정리, 30일 주기 유지 갱신 때만 커밋됩니다.
- 공개 저장소의 예약 실행이 장기 미활동으로 꺼지지 않도록 30일마다 상태 시각만 갱신합니다.
- 각 실행의 예약 시각, 실제 시작 시각, 호출 지연, 조회 건수, 신규 알림 수를 GitHub Actions 실행 요약에서 확인할 수 있습니다.

## GitHub 설정

1. 이 폴더를 공개 GitHub 저장소에 올립니다.
2. Discord에서 알림을 받을 채널의 Webhook을 만듭니다.
3. GitHub `Settings > Secrets and variables > Actions`에 `DISCORD_WEBHOOK_URL`로 저장합니다.
4. 관리 사이트의 `지금 감지하기`로 첫 실행을 시작합니다.

Discord 연결만 다시 확인하려면 관리 사이트의 `Discord 테스트`를 누릅니다. `CGV Open Watch 테스트`라고 표시된 메시지를 보내므로 실제 예매 오픈 알림과 혼동되지 않습니다.

저장소나 조직에서 Actions의 쓰기 권한을 제한했다면 `Settings > Actions > General > Workflow permissions`에서 상태 파일 커밋을 허용해야 합니다. 기본 브랜치가 보호되어 자동 커밋을 막는 경우에도 예외 설정이 필요합니다.

새 규칙의 첫 실행은 현재 열려 있는 회차를 기준선으로만 저장하고 알림하지 않습니다. 규칙 편집 화면에서 `첫 저장 직후 이미 열린 회차도 알림`을 켠 경우에만 기존 회차도 알립니다.

## 관리 사이트

[CGV Open Watch 관리 사이트](https://cgv-open-watch-scheduler.rladydals8939.workers.dev)에서 다음 항목을 직접 관리할 수 있습니다.

- 여러 영화 감시 규칙 추가, 편집, 삭제, 개별 활성화
- 빠른 설정에서 영화·극장·SCREENX/IMAX/4DX·날짜를 한 화면에서 즉시 변경
- 영화·극장 통합 검색 Picker, 지역 필터, 키보드 이동, 모바일 바텀시트 지원
- 스파이더맨·용산아이파크몰·SCREENX 프리셋과 오늘·내일·이번 토요일 날짜 단축 선택
- CGV 최신 영화 목록 또는 아직 목록에 없는 영화 직접 입력
- 지역 검색과 복수 극장 선택, 검색 조건을 바꿔도 선택한 극장 유지
- IMAX, 4DX, SCREENX 등 상영 형식과 특정 상영관 이름 지정
- 오늘부터 N일, 기간 범위, 특정 날짜 지정
- 상영 시간대와 최소 잔여 좌석 설정
- 전체 일시정지, 즉시 감지, Discord 테스트, CGV 목록 갱신
- 예매 완료 버튼으로 개별 감시 종료, 지난 특정 날짜 규칙 자동 종료
- 최근 GitHub Actions 실행 결과, 설정 가져오기와 내보내기

설정은 Cloudflare D1에 보관되며 GitHub 토큰과 관리 비밀번호는 Worker Secret에만 저장됩니다. 관리 비밀번호를 바꾸려면 다음 명령을 실행합니다.

```bash
npx --yes wrangler@4.118.0 secret put ADMIN_PASSWORD --config scheduler/wrangler.jsonc
```

## 적응형 외부 스케줄러 설정

GitHub의 `schedule`은 5분 cron을 설정해도 지연되거나 일부 실행이 누락될 수 있습니다. 이 저장소는 `scheduler/`의 Cloudflare Worker가 평소 5분, 특정 상영일 5일 전부터 2분마다 `workflow_dispatch`를 호출하는 방식을 기본 경로로 사용합니다.

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 무료 계정으로 로그인합니다.
2. 로컬에서 `npx --yes wrangler@4.118.0 login`을 실행하고 브라우저 승인을 완료합니다.
3. [GitHub Fine-grained token 만들기](https://github.com/settings/personal-access-tokens/new)에서 저장소를 `twy8939/cgv-open-watch` 하나만 선택하고 `Actions: Read and write` 권한만 부여합니다.
4. `npm run scheduler:secret`을 실행해 토큰을 `GITHUB_TOKEN` Secret으로 저장합니다. 토큰은 파일이나 GitHub 저장소에 넣지 않습니다.
5. D1 데이터베이스와 `ADMIN_PASSWORD`, `SESSION_SECRET` Worker Secret을 설정합니다.
6. `npm run scheduler:deploy`로 배포합니다.
7. 최대 15분의 전파 시간 후 GitHub Actions에서 `cloudflare-cron` 호출이 현재 표시된 간격으로 생성되는지 연속 3회 확인합니다.

두 Cron은 합쳐 하루 1,008회 Worker를 깨우지만 현재 날짜에 맞는 하나만 GitHub Actions를 호출합니다. 실제 감시 작업은 5분 모드 하루 288회, 2분 모드 하루 720회입니다. Cloudflare Worker 무료 플랜의 하루 100,000회 요청 범위 안이며, GitHub 토큰은 외부 호출기가 이 저장소의 감시 워크플로만 시작하는 용도입니다. Discord Webhook은 계속 GitHub Secret에만 보관됩니다.

## 로컬 점검

Node.js 22와 Google Chrome이 필요합니다.

```bash
npm install
npm test
npm run check -- --dry-run
```

Chrome을 기본 경로에서 찾지 못하면 `CHROME_PATH`를 지정합니다.

## 파일로 감시 대상 변경

보통은 관리 사이트를 사용합니다. 로컬 점검용 기본값은 [`config/watch.json`](./config/watch.json)에서 변경할 수 있습니다.

```json
{
  "movieTitle": "스파이더맨-브랜드 뉴 데이",
  "movieNo": "30001192",
  "formats": [],
  "lookAheadDays": 14
}
```

`formats`가 빈 배열이면 일반관을 포함한 모든 형식을 감시합니다. 원하는 형식만 감시하려면 다음처럼 입력합니다.

```json
{
  "formats": ["IMAX", "4DX", "SCREENX"]
}
```

`"*"`, `"ALL"`, `"전체"`도 모든 형식을 의미합니다. 지점을 추가하려면 `theatres` 배열에 다음 정보를 넣습니다.

```json
{
  "name": "용산아이파크몰",
  "siteNo": "0013",
  "regionCode": "01"
}
```

## 주의사항

- 표준 실행기를 쓰는 공개 GitHub 저장소는 Actions 사용료가 없습니다. 비공개 저장소는 5분 주기라면 무료 제공량을 넘길 가능성이 큽니다.
- 설정된 주기는 평소 5분, 목표 날짜 5일 전부터 2분이지만 전파 지연, GitHub 실행 대기, CGV 응답 지연 때문에 알림 도착 시간을 절대적으로 보장할 수는 없습니다. 실행 요약의 `트리거 지연`으로 실제 상태를 확인합니다.
- CGV가 화면이나 응답 구조를 바꾸면 실패할 수 있으며, 이 경우 오탐을 보내지 않고 Actions를 실패 처리합니다.
- Discord 오류나 실행 중단으로 보내지 못한 회차는 Git에 남은 대기열을 이용해 다음 실행에서 재시도합니다.
- Discord 전송 성공 직후 완료 상태 커밋 전에 실행기가 강제 종료되는 극히 짧은 구간에는 같은 알림이 한 번 더 갈 수 있습니다. Discord Webhook과 Git 사이에 원자적 트랜잭션이 없어 이 구간을 완전히 없앨 수는 없습니다.
