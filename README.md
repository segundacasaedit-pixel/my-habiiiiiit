# My habiiiiiit

習慣トラッカー ＋ 目標設定アプリ（静的HTML/CSS/JavaScriptのみ・ビルド不要）

## ファイル構成
- `index.html` — ページ構造
- `style.css` — デザイン（ネイビー基調＋オレンジ/ティールアクセント）
- `app.js` — アプリのロジック（データはブラウザの localStorage に保存されます）

## GitHubで無料公開する手順（GitHub Pages）

1. GitHubで新しいリポジトリを作成（例: `my-habiiiiiit`）
2. この3つのファイル（`index.html` / `style.css` / `app.js`）をリポジトリ直下にアップロード
3. リポジトリの **Settings → Pages** を開く
4. "Build and deployment" の **Source** を `Deploy from a branch` に設定
5. Branch を `main`（フォルダは `/root`）に設定して **Save**
6. 数分待つと、`https://（あなたのユーザー名）.github.io/my-habiiiiiit/` のようなURLで公開されます

## 注意点
- ブラウザの「サイトデータを消去」やシークレットモードを使うと保存内容が消えるので注意してください。
- iPhoneでは、Safariで開いたあと「共有」→「ホーム画面に追加」しておくと、アプリのように起動できます。

## iPhoneとMacでデータを同期する（無料・Firebase）

デフォルトのままだと、データは各端末（各ブラウザ）にバラバラに保存されます。同じデータをiPhoneとMac両方で見たい場合は、無料のFirebase Realtime Databaseを使って同期できます。

1. https://console.firebase.google.com にアクセスし、Googleアカウントで新規プロジェクトを作成（無料）
2. 左メニューの「構築」→「Realtime Database」→「データベースを作成」
   - ロケーションは任意（例：us-central1）
   - セキュリティルールは「テストモードで開始」を選択（30日間は誰でも読み書き可能。期限が切れたら下記のルールに変更してください）
3. データベース作成後、「ルール」タブを開いて次の内容に変更し「公開」：
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   ※これは「URLとパスを知っていれば誰でも読み書きできる」設定です。習慣データという性質上、個人利用であればリスクは低いですが、機密情報は入れないようにしてください。
4. 左メニューの「プロジェクトの設定」（歯車アイコン）→ 下の方の「アプリを追加」→ ウェブアプリ（`</>`アイコン）を選択し、適当な名前で登録
5. 表示された `firebaseConfig` の中身（`apiKey`, `authDomain`, `databaseURL`, `projectId`）をコピー
6. `app.js` の中の以下の部分を、コピーした値に書き換える：
   ```js
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY_HERE",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
     projectId: "YOUR_PROJECT_ID",
   };
   ```
7. GitHubに変更をアップロード（コミット）し直せば、GitHub Pagesにも反映されます

これで、iPhoneで入力した内容がMacにも（数秒で）自動的に反映されるようになります。設定しなくてもアプリ自体は普通に動くので、後回しでも大丈夫です。
