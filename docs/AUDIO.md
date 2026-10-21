# Audio

## 現在の実装

BGMと効果音のON/OFFをステータスバーから変更し、`audioSettings` として主localStorageへ保存します。ブラウザの自動再生制限に合わせ、最初のpointerdownまたはkeydownで音声を解除します。

## 参照音源

`public/audio/` に次のMP3を期待します。

- `bgm-pop-loop.mp3`
- `sfx-complete.mp3`
- `sfx-ticket.mp3`
- `sfx-roulette-start.mp3`
- `sfx-roulette-stop.mp3`
- `sfx-success.mp3`
- `sfx-card.mp3`
- `sfx-click.mp3`
- `sfx-error.mp3`

現在は `.gitkeep` とREADMEだけで、MP3は未配置です。

## フォールバック

外部音源がない／再生失敗の場合、Web Audio APIのoscillatorで効果音を生成します。BGMも8音の配列を720ms間隔で繰り返します。したがって音源404でも操作自体は継続できます。

## 設定

初期値はBGM有効・効果音有効、BGM音量0.22、効果音音量0.62です。現行UIはON/OFFだけで音量スライダーはありません。BGM停止時は外部Audioとフォールバックtimerを止めます。
