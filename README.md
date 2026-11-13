# GitHub Actions Windows Desktop

## 使用方法

1. このリポジトリをFork（フォーク）する
2. [Windows Desktopワークフロー](../../actions/workflows/desktop.yml)を開く
3. ワークフローを実行し、ログに表示されたDesktopのURLを開く
4. `x` または `x/` をアドレスバーに入力してセッションを停止する

各ワークフローは `windows-latest` runner 上で Windows デスクトップを起動し、noVNC と Cloudflare Tunnel 経由でブラウザーから接続します。通常のワークフローには VNC パスワードがありません。`Windows Desktop Password` では ASCII 英数字1〜8文字の VNC パスワードを指定できます。

Chrome、Firefox、Edge のワークフローでは、それぞれのブラウザーを起動します。Chromium ワークフローも、runner にインストール済みの Chrome を起動します。Chrome のプロファイルは Actions cache に保存されます。

旧 Linux デスクトップ、ディストリビューション、Claude Desktop、LM Studio、VPN、SSH の各ワークフローは、Windows デスクトップに置き換わりました。これらの Linux 固有環境や追加機能は含まれません。日本語ワークフローも、Windows のシステム言語は変更しません。

GitHub-hosted runner はセッションごとに破棄され、実行時間にも上限があります。
