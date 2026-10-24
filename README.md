# sakata-lab-bot

[坂田・森・浅谷研究室](https://www.sakatalab.t.u-tokyo.ac.jp/)の Slack で動作する Slack bot のソースコードです。

坂田研学生からの pull request は積極的に受け付けます!

## About

`functions/` 以下のソースをもとに、Slack Events を受け取る `sakataLabSlackEventsReceiver` 関数が Cloud Functions 上で動作します。

### Slack 絵文字・チャンネル追加通知

新しいチャンネルが作成されたり、チャンネルが unarchive されたり、絵文字が追加・削除・改名されたりした時に投稿します。

### サーバーメモリ逼迫状況通知

坂田研では [Mackerel](https://ja.mackerel.io/) を用いてサーバー監視を行っています。Mackerel がメモリ逼迫を検知した場合、公式 Slack 連携のかわりにこの bot が Slack に通知を行い、原因ユーザー特定やグラフ添付を行います。グラフは img.hideo54.com に保存し永続化します。

また、1日に1度、カーネルが生きたまましばらく使われておらず無駄にメモリを消費している Jupyter セッションを検知し、Slack に通知します。

## setup

* `cd functions; cp sample.env .env` + よしなに
* GitHub Actions による自動デプロイは……組んでないです……やりたいね
* Slack App の構成は Manifest 参照。
