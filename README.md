# LD-1 · Loop Device

iPhone向けの縦画面ループDAW（PWA）。Safariで開いて「共有 → ホーム画面に追加」するとフルスクリーンのWebアプリとして使えます。

https://417si.github.io/claude-artifact/

## 構成

| タブ | 内容 |
|---|---|
| 01 DRUM | 6音色（KICK / SNARE / CLAP / C.HAT / O.HAT / PERC）の16ステップ。キット 808 / 909 / TECH / LOFI。パッドを叩くと発音、REC中は打ち込みとして記録 |
| 02 BASS | モノシンセ。コードのルートに追従する度数ステップ（FOLLOW CHORD）。SOUNDでシンセ編集 |
| 03 CHORD | 小節ごとにダイアトニックコード（I〜VII、TRI/7TH/SUS/ADD9/POW）。リズム16ステップ、自動ボイスリーディング |
| 04 LEAD | 左が低く右が高い3段の横型キー。タッチはキーの音に吸着、横に動かすと隣の音へスライド、縦に大きく動かすとチョーキング。SCALE / PENTA / CHROM |
| 05 MIX | フェーダー、メーター、M/S、ディレイ/リバーブ送り、マスター |
| 06 SONG | BPM・TAP・スウィング、キー/スケール、シーン長、コピー/ペースト、ソングチェイン、BOUNCE（音声書き出し） |

- **A–D** は展開（シーン）。再生中に押すとループの終わりで切り替わります
- **● REC** を押して再生すると、LEADの演奏・ドラムパッド・フィルターXYの動き（モーション）がループに重ね録りされます
- データは端末内（localStorage）に自動保存

## 技術

Web Audio API のみ、ビルド不要の静的ファイル。`.github/workflows/pages.yml` で main への push 時に GitHub Pages へデプロイ。

フォント: [Doto](https://github.com/oliverlalan/Doto) / [IBM Plex Mono](https://github.com/IBM/plex)（SIL OFL 1.1, `fonts/` にライセンス同梱）
