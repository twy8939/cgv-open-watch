# CGV SCREENX Watch

CGV 공개 예매 화면에서 `스파이더맨-브랜드 뉴 데이`의 SCREENX 회차가 새로 열리면 Discord로 알리는 감시기입니다. 기본 지점은 CGV 용산아이파크몰입니다.

## 운영 방식

- GitHub Actions가 매시 2분부터 5분 간격으로 실행됩니다. 하루 최대 288회입니다.
- CGV 지점 공개 화면을 Chrome으로 열고, 화면이 사용하는 공식 읽기 전용 일정 응답을 확인합니다.
- 로그인, CAPTCHA, 유료 기능, 접근 제한을 우회하지 않습니다.
- 발견한 회차와 아직 보내지 못한 알림은 `state/notifications.json`에 저장해 재시작 후에도 이어서 처리합니다.
- 같은 날짜에 함께 열린 회차는 한 메시지로 묶어 Discord 알림 폭주를 줄입니다.
- CGV의 일시적 서버 오류와 Discord 요청 제한은 제한된 횟수만 자동 재시도합니다.
- 새 회차를 먼저 상태 파일에 커밋하고 Discord 전송에 성공한 회차만 대기열에서 제거합니다.
- 상태 파일은 새 회차 발견, 전송 완료, 오래된 기록 정리, 30일 주기 유지 갱신 때만 커밋됩니다.
- 공개 저장소의 예약 실행이 장기 미활동으로 꺼지지 않도록 30일마다 상태 시각만 갱신합니다.

## GitHub 설정

1. 이 폴더를 공개 GitHub 저장소에 올립니다.
2. Discord에서 알림을 받을 채널의 Webhook을 만듭니다.
3. GitHub `Settings > Secrets and variables > Actions`에 `DISCORD_WEBHOOK_URL`로 저장합니다.
4. `Actions > CGV SCREENX watch > Run workflow`로 첫 실행을 시작합니다.

저장소나 조직에서 Actions의 쓰기 권한을 제한했다면 `Settings > Actions > General > Workflow permissions`에서 상태 파일 커밋을 허용해야 합니다. 기본 브랜치가 보호되어 자동 커밋을 막는 경우에도 예외 설정이 필요합니다.

첫 실행은 현재 열려 있는 회차를 기준선으로만 저장하고 알림하지 않습니다. 이미 열린 회차도 즉시 알림하려면 수동 실행의 `notify_existing`을 켭니다.

## 로컬 점검

Node.js 22와 Google Chrome이 필요합니다.

```bash
npm install
npm test
npm run check -- --dry-run
```

Chrome을 기본 경로에서 찾지 못하면 `CHROME_PATH`를 지정합니다.

## 감시 지점 변경

[`config/watch.json`](./config/watch.json)의 `theatres`에 지점을 추가합니다.

```json
{
  "name": "용산아이파크몰",
  "siteNo": "0013",
  "detailNo": "0013001"
}
```

## 주의사항

- 표준 실행기를 쓰는 공개 GitHub 저장소는 Actions 사용료가 없습니다. 비공개 저장소는 5분 주기라면 무료 제공량을 넘길 가능성이 큽니다.
- GitHub의 예약 실행은 상황에 따라 5분보다 늦어질 수 있습니다.
- CGV가 화면이나 응답 구조를 바꾸면 실패할 수 있으며, 이 경우 오탐을 보내지 않고 Actions를 실패 처리합니다.
- Discord 오류나 실행 중단으로 보내지 못한 회차는 Git에 남은 대기열을 이용해 다음 실행에서 재시도합니다.
- Discord 전송 성공 직후 완료 상태 커밋 전에 실행기가 강제 종료되는 극히 짧은 구간에는 같은 알림이 한 번 더 갈 수 있습니다. Discord Webhook과 Git 사이에 원자적 트랜잭션이 없어 이 구간을 완전히 없앨 수는 없습니다.
