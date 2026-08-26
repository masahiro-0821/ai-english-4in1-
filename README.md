# AI English 4-in-1 スマホ版

4つの英会話トレーニングを1つのスマホ向けPWAに統合しています。

## 使い方
1. Node.js 18以上をインストール
2. `.env.example` を `.env` にコピー
3. `OPENAI_API_KEY` にOpenAI APIキーを入力
4. ターミナルで `npm install`
5. `npm start`
6. ブラウザで `http://localhost:3000`

## 4機能
- じぶんごとフレーズ
- ミッションクリア英会話
- 意味理解リスニング
- 流暢性・部分練習

## スマホ
HTTPSでサーバー公開すれば、iPhone/Androidのブラウザから利用できます。
ホーム画面に追加すると、通常のアプリに近い形で開けます。

## OpenAI
教材生成と会話判定にResponses APIを使用します。
APIキーはフロント側に置かず、サーバー側の環境変数で管理します。
