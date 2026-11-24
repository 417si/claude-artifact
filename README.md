# claude-artifact

- `/` — ポケットLLM: ブラウザ内（WebGPU / WebLLM）で動くチャット。会話ログはCookieに圧縮保存。
- `/video/` — ムービーラボ: スマホで撮った動画を端末内に溜め、ブラウザ内（TensorFlow.js）で学習して似た雰囲気の動画を生成。
- `/photo/` — フォトラボ: 写真をまとめて選んで端末内に溜め、ブラウザ内でVAEを学習して新しい画像を生成。
- `colab/photolab_hq.ipynb` — フォトラボHQ: Google Colabの無料GPUで、写真の被写体をSDXLに覚えさせ（DreamBooth LoRA）高画質な画像を生成。[Colabで開く](https://colab.research.google.com/github/417si/claude-artifact/blob/main/colab/photolab_hq.ipynb)
- `/omikuji/` — 今日のおみくじ
