# sakata-lab-slack

[坂田・森・浅谷研究室](https://www.sakatalab.t.u-tokyo.ac.jp/)の Slack で動作する Slack bot のソースコードです。

坂田研学生からの pull request は積極的に受け付けます!

## About

`functions/` 以下のソースをもとに、Slack Events を受け取る `sakataLabSlackEventsReceiver` 関数が Cloud Functions 上で動作します。

### notifier

新しいチャンネルが作成されたり、チャンネルが unarchive されたり、絵文字が追加・削除・改名されたりした時に投稿します。

## setup

* `cd functions; cp sample.env .env` + よしなに
* GitHub Actions による自動デプロイは……組んでないです……やりたいね
* Slack App の構成は Manifest 参照。
