// Firebaseコンソールの「プロジェクトの設定 → 全般 → マイアプリ」に表示される
// firebaseConfig の値を、下の中身とそっくり入れ替えてください。
// この値は公開されても問題ありません（Firebaseの仕組み上、これ自体は秘密の鍵ではなく、
// 実際のアクセス制御はFirestoreの「ルール」側で行います）。

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
