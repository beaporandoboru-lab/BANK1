import { useState, useEffect, useRef } from "react";
import { LogOut, ArrowLeft, History } from "lucide-react";
import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, updateDoc, addDoc, collection,
  onSnapshot, query, orderBy, limit, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&family=Courier+Prime:wght@400;700&display=swap');`;

const CURRENCY = "CZ$";
const MINUS_TYPES = ["confiscate", "withdraw"];
const TYPE_LABEL = { transfer: "送金", issue: "発行", confiscate: "没収", deposit: "入金", withdraw: "出金" };
const REQ_STATUS_LABEL = { pending: "承認待ち", approved: "承認済み", rejected: "却下" };

function fmtTs(ts) {
  if (!ts || typeof ts.toDate !== "function") return "送信中...";
  return ts.toDate().toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mapAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "そのメールアドレスは既に使われています。";
  if (code.includes("invalid-email")) return "メールアドレスの形式が正しくありません。";
  if (code.includes("weak-password")) return "パスワードは6文字以上にしてください。";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential"))
    return "メールアドレスまたはパスワードが正しくありません。";
  return "エラーが発生しました。もう一度お試しください。";
}

function HankoStamp({ show }) {
  return (
    <div className={"hanko-wrap" + (show ? " hanko-show" : "")} aria-hidden="true">
      <svg viewBox="0 0 120 120" width="96" height="96">
        <defs>
          <filter id="inkbleed" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" />
          </filter>
        </defs>
        <g filter="url(#inkbleed)">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#b3382c" strokeWidth="6" />
          <text x="60" y="52" textAnchor="middle" fontSize="15" fill="#b3382c" fontFamily="'Shippori Mincho', serif">処理</text>
          <text x="60" y="80" textAnchor="middle" fontSize="22" fill="#b3382c" fontFamily="'Shippori Mincho', serif">完了</text>
        </g>
      </svg>
    </div>
  );
}

function RequestHistory({ requests, accountUid }) {
  const mine = requests.filter((r) => r.accountUid === accountUid);
  if (mine.length === 0) return null;
  return (
    <div className="request-history">
      <p className="request-history-title">あなたの申請状況</p>
      {mine.map((r) => (
        <div key={r.id} className="request-history-row">
          <span className="type-chip">{r.type === "deposit" ? "入金" : "出金"}</span>
          <span>{r.amount.toLocaleString()} {CURRENCY}</span>
          <span className={"req-status req-" + r.status}>{REQ_STATUS_LABEL[r.status]}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null); // {uid, email} | null
  const [profile, setProfile] = useState(null); // accounts/{uid} doc data
  const [accountsMap, setAccountsMap] = useState({}); // uid -> account data
  const [requests, setRequests] = useState([]);
  const [txLog, setTxLog] = useState([]);

  const [screen, setScreen] = useState("login"); // 'login' | 'signup'
  const [appScreen, setAppScreen] = useState("home");
  const [showStamp, setShowStamp] = useState(false);
  const stampTimer = useRef(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginError, setLoginError] = useState("");

  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");
  const [suPw2, setSuPw2] = useState("");
  const [suName, setSuName] = useState("");
  const [suError, setSuError] = useState("");

  const [xferTo, setXferTo] = useState("");
  const [xferAmt, setXferAmt] = useState("");
  const [xferMemo, setXferMemo] = useState("");
  const [xferError, setXferError] = useState("");

  const [depositAmt, setDepositAmt] = useState("");
  const [depositMemo, setDepositMemo] = useState("");
  const [depositError, setDepositError] = useState("");
  const [depositNotice, setDepositNotice] = useState("");

  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawMemo, setWithdrawMemo] = useState("");
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawNotice, setWithdrawNotice] = useState("");

  const [adminTarget, setAdminTarget] = useState("");
  const [adminAmt, setAdminAmt] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [adminError, setAdminError] = useState("");

  // --- auth state ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u ? { uid: u.uid, email: u.email } : null);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // --- my profile doc ---
  useEffect(() => {
    if (!authUser) { setProfile(null); return; }
    const ref = doc(db, "accounts", authUser.uid);
    const unsub = onSnapshot(ref, (snap) => setProfile(snap.exists() ? snap.data() : null));
    return unsub;
  }, [authUser]);

  // --- all accounts (for transfer/admin target lists) ---
  useEffect(() => {
    if (!authUser) { setAccountsMap({}); return; }
    const unsub = onSnapshot(collection(db, "accounts"), (snap) => {
      const map = {};
      snap.forEach((d) => { map[d.id] = d.data(); });
      setAccountsMap(map);
    });
    return unsub;
  }, [authUser]);

  // --- requests (rules automatically limit non-admins to their own) ---
  useEffect(() => {
    if (!authUser) { setRequests([]); return; }
    const q = query(collection(db, "requests"), orderBy("ts", "desc"));
    const unsub = onSnapshot(q, (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [authUser]);

  // --- ledger history ---
  useEffect(() => {
    if (!authUser) { setTxLog([]); return; }
    const q = query(collection(db, "transactions"), orderBy("ts", "desc"), limit(50));
    const unsub = onSnapshot(q, (snap) => setTxLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [authUser]);

  const isAdmin = profile?.role === "admin";

  function fireStamp() {
    setShowStamp(true);
    clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setShowStamp(false), 1400);
  }

  function goHome() {
    setAppScreen("home");
    setXferError(""); setDepositError(""); setWithdrawError(""); setAdminError("");
    setDepositNotice(""); setWithdrawNotice("");
  }

  async function handleLogin() {
    setLoginError("");
    if (!loginEmail.trim() || !loginPw) return setLoginError("メールアドレスとパスワードを入力してください。");
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPw);
      setLoginEmail(""); setLoginPw("");
      setAppScreen("home");
    } catch (err) {
      setLoginError(mapAuthError(err));
    }
  }

  async function handleSignup() {
    setSuError("");
    const name = suName.trim();
    if (!name) return setSuError("表示名（ニックネーム）を入力してください。");
    if (!suEmail.trim()) return setSuError("メールアドレスを入力してください。");
    if (suPw.length < 6) return setSuError("パスワードは6文字以上にしてください。");
    if (suPw !== suPw2) return setSuError("パスワードが一致していません。");
    try {
      const cred = await createUserWithEmailAndPassword(auth, suEmail.trim(), suPw);
      await setDoc(doc(db, "accounts", cred.user.uid), { name, role: "member", balance: 0 });
      setSuName(""); setSuEmail(""); setSuPw(""); setSuPw2("");
      setScreen("login");
      setAppScreen("home");
    } catch (err) {
      setSuError(mapAuthError(err));
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setScreen("login");
    setAppScreen("home");
  }

  async function handleTransfer() {
    setXferError("");
    const amt = Number(xferAmt);
    if (!xferTo) return setXferError("送金先を選んでください。");
    if (xferTo === authUser.uid) return setXferError("自分自身には送金できません。");
    if (!amt || amt <= 0) return setXferError(`1${CURRENCY}以上の金額を入力してください。`);
    try {
      await runTransaction(db, async (tx) => {
        const senderRef = doc(db, "accounts", authUser.uid);
        const receiverRef = doc(db, "accounts", xferTo);
        const senderSnap = await tx.get(senderRef);
        const receiverSnap = await tx.get(receiverRef);
        if (!senderSnap.exists() || !receiverSnap.exists()) throw new Error("missing");
        const senderBal = senderSnap.data().balance;
        const receiverBal = receiverSnap.data().balance;
        if (amt > senderBal) throw new Error("insufficient");
        tx.update(senderRef, { balance: senderBal - amt });
        tx.update(receiverRef, { balance: receiverBal + amt });
        const ledgerRef = doc(collection(db, "transactions"));
        tx.set(ledgerRef, {
          type: "transfer", fromUid: authUser.uid, fromName: profile.name,
          toUid: xferTo, toName: receiverSnap.data().name, amount: amt,
          memo: xferMemo || "(メモなし)", ts: serverTimestamp(),
        });
      });
      setXferAmt(""); setXferMemo("");
      fireStamp();
    } catch (err) {
      if (err.message === "insufficient") setXferError(`残高が不足しています（現在の残高: ${profile.balance.toLocaleString()}${CURRENCY}）。`);
      else setXferError("送金に失敗しました。もう一度お試しください。");
    }
  }

  async function handleDeposit() {
    setDepositError("");
    const amt = Number(depositAmt);
    if (!amt || amt <= 0) return setDepositError(`1${CURRENCY}以上の金額を入力してください。`);
    try {
      await addDoc(collection(db, "requests"), {
        type: "deposit", accountUid: authUser.uid, accountName: profile.name,
        amount: amt, memo: depositMemo || "ATM入金", status: "pending", ts: serverTimestamp(),
      });
      setDepositAmt(""); setDepositMemo("");
      setDepositNotice("入金を申請しました。管理者の承認をお待ちください。");
    } catch (err) {
      setDepositError("申請に失敗しました。もう一度お試しください。");
    }
  }

  async function handleWithdraw() {
    setWithdrawError("");
    const amt = Number(withdrawAmt);
    if (!amt || amt <= 0) return setWithdrawError(`1${CURRENCY}以上の金額を入力してください。`);
    if (amt > profile.balance) return setWithdrawError(`残高が不足しています（現在の残高: ${profile.balance.toLocaleString()}${CURRENCY}）。`);
    try {
      await addDoc(collection(db, "requests"), {
        type: "withdraw", accountUid: authUser.uid, accountName: profile.name,
        amount: amt, memo: withdrawMemo || "ATM出金", status: "pending", ts: serverTimestamp(),
      });
      setWithdrawAmt(""); setWithdrawMemo("");
      setWithdrawNotice("出金を申請しました。管理者の承認をお待ちください。");
    } catch (err) {
      setWithdrawError("申請に失敗しました。もう一度お試しください。");
    }
  }

  async function approveRequest(req) {
    setAdminError("");
    try {
      await runTransaction(db, async (tx) => {
        const reqRef = doc(db, "requests", req.id);
        const reserveRef = doc(db, "accounts", "reserve");
        const targetRef = doc(db, "accounts", req.accountUid);
        const reqSnap = await tx.get(reqRef);
        const reserveSnap = await tx.get(reserveRef);
        const targetSnap = await tx.get(targetRef);
        if (!reqSnap.exists() || reqSnap.data().status !== "pending") throw new Error("already-handled");
        if (!reserveSnap.exists() || !targetSnap.exists()) throw new Error("missing");
        const reserveBal = reserveSnap.data().balance;
        const targetBal = targetSnap.data().balance;
        if (req.type === "deposit") {
          if (req.amount > reserveBal) throw new Error("reserve-insufficient");
          tx.update(reserveRef, { balance: reserveBal - req.amount });
          tx.update(targetRef, { balance: targetBal + req.amount });
        } else {
          if (req.amount > targetBal) throw new Error("target-insufficient");
          tx.update(targetRef, { balance: targetBal - req.amount });
          tx.update(reserveRef, { balance: reserveBal + req.amount });
        }
        tx.update(reqRef, { status: "approved", decidedTs: serverTimestamp() });
        const ledgerRef = doc(collection(db, "transactions"));
        tx.set(ledgerRef, {
          type: req.type,
          fromUid: req.type === "deposit" ? "reserve" : req.accountUid,
          fromName: req.type === "deposit" ? "発行準備金" : req.accountName,
          toUid: req.type === "deposit" ? req.accountUid : "reserve",
          toName: req.type === "deposit" ? req.accountName : "発行準備金",
          amount: req.amount, memo: req.memo, ts: serverTimestamp(),
        });
      });
      fireStamp();
    } catch (err) {
      if (err.message === "reserve-insufficient") setAdminError("発行準備金が不足しているため承認できません。");
      else if (err.message === "target-insufficient") setAdminError(`${req.accountName}の残高が不足しているため承認できません。`);
      else if (err.message === "already-handled") setAdminError("この申請はすでに処理されています。");
      else setAdminError("承認処理に失敗しました。もう一度お試しください。");
    }
  }

  async function rejectRequest(req) {
    setAdminError("");
    try {
      await updateDoc(doc(db, "requests", req.id), { status: "rejected", decidedTs: serverTimestamp() });
    } catch (err) {
      setAdminError("却下処理に失敗しました。もう一度お試しください。");
    }
  }

  async function handleAdmin(kind) {
    setAdminError("");
    const amt = Number(adminAmt);
    const target = accountsMap[adminTarget];
    if (!adminTarget || !target) return setAdminError("対象アカウントを選んでください。");
    if (!amt || amt <= 0) return setAdminError(`1${CURRENCY}以上の金額を入力してください。`);
    try {
      await runTransaction(db, async (tx) => {
        const reserveRef = doc(db, "accounts", "reserve");
        const targetRef = doc(db, "accounts", adminTarget);
        const reserveSnap = await tx.get(reserveRef);
        const targetSnap = await tx.get(targetRef);
        const reserveBal = reserveSnap.data().balance;
        const targetBal = targetSnap.data().balance;
        if (kind === "confiscate" && amt > targetBal) throw new Error("target-insufficient");
        if (kind === "issue") {
          tx.update(reserveRef, { balance: reserveBal - amt });
          tx.update(targetRef, { balance: targetBal + amt });
        } else {
          tx.update(targetRef, { balance: targetBal - amt });
          tx.update(reserveRef, { balance: reserveBal + amt });
        }
        const ledgerRef = doc(collection(db, "transactions"));
        tx.set(ledgerRef, {
          type: kind,
          fromUid: kind === "issue" ? "reserve" : adminTarget,
          fromName: kind === "issue" ? "発行準備金" : target.name,
          toUid: kind === "issue" ? adminTarget : "reserve",
          toName: kind === "issue" ? target.name : "発行準備金",
          amount: amt, memo: adminReason || "(理由未記入)", ts: serverTimestamp(),
        });
      });
      setAdminAmt(""); setAdminReason("");
      fireStamp();
    } catch (err) {
      if (err.message === "target-insufficient") setAdminError("没収額が対象の残高を超えています。");
      else setAdminError("処理に失敗しました。もう一度お試しください。");
    }
  }

  const transferTargets = authUser
    ? Object.entries(accountsMap).filter(([uid, a]) => a.role !== "reserve" && uid !== authUser.uid).map(([uid, a]) => ({ uid, ...a }))
    : [];
  const adminTargets = Object.entries(accountsMap).filter(([, a]) => a.role !== "reserve").map(([uid, a]) => ({ uid, ...a }));
  const pendingRequests = requests.filter((r) => r.status === "pending");

  const sharedStyle = (
    <style>{`
      ${FONT_IMPORT}
      .bank-app {
        --ink:#242220; --paper:#f2ebd8; --panel:#faf6ea; --navy:#1e3a5f; --navy-dark:#152a45;
        --hanko:#b3382c; --gold:#a8823c; --sage:#5b6f5b; --line:#d9cfae;
        font-family:'Noto Sans JP', sans-serif; color:var(--ink); background:var(--paper);
        max-width:520px; margin:0 auto; padding:18px; border-radius:6px;
        box-shadow:0 1px 3px rgba(0,0,0,0.08); position:relative; box-sizing:border-box;
      }
      .bank-app *{box-sizing:border-box;}

      .auth-wrap{
        background:var(--panel); border:1px solid var(--line);
        border-radius:8px; padding:30px 28px; text-align:center;
        box-shadow:0 2px 10px rgba(30,58,95,0.1);
      }
      .auth-title{font-family:'Shippori Mincho', serif; font-size:28px; font-weight:700; color:var(--navy); margin:0;}
      .auth-sub{font-size:11px; letter-spacing:.14em; color:var(--gold); margin-top:4px; text-transform:uppercase;}
      .auth-divider{height:2px; width:44px; background:var(--hanko); margin:16px auto 20px;}
      .auth-form{text-align:left;}
      .form-row{margin-bottom:14px;}
      .form-row label{display:block; font-size:12px; color:#6b6355; margin-bottom:5px; letter-spacing:.03em;}
      .form-row select, .form-row input{
        width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:4px; background:#fff;
        font-family:'Noto Sans JP', sans-serif; font-size:14px; color:var(--ink);
      }
      .form-row input[type=number]{font-family:'Courier Prime', monospace;}
      .form-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
      .auth-btn{
        width:100%; background:var(--navy); color:#f2ebd8; border:none; padding:11px 0; border-radius:4px;
        font-size:14px; font-weight:700; letter-spacing:.05em; cursor:pointer; font-family:'Noto Sans JP', sans-serif;
      }
      .auth-btn:hover{background:var(--navy-dark);}
      .auth-note{font-size:11.5px; color:#8a8270; margin-top:14px; letter-spacing:.03em;}
      .auth-switch{margin-top:16px; padding-top:14px; border-top:1px dashed var(--line); font-size:12.5px; text-align:center;}
      .link-btn{
        background:none; border:none; color:var(--hanko); font-weight:700; cursor:pointer; font-size:12.5px;
        font-family:'Noto Sans JP', sans-serif; padding:0;
      }
      .link-btn:hover{text-decoration:underline;}
      .err-note{
        font-size:12.5px; color:var(--hanko); border-bottom:1px dashed var(--hanko);
        display:inline-block; padding-bottom:2px; margin-bottom:10px;
      }

      .topbar{display:flex; align-items:center; justify-content:space-between; padding:2px 2px 14px;}
      .topbar-logo{font-family:'Shippori Mincho', serif; font-weight:700; font-size:19px; color:var(--navy); letter-spacing:.03em;}
      .topbar-actions{display:flex; gap:8px;}
      .pill-btn{
        display:flex; align-items:center; gap:5px; background:#fff; color:var(--navy);
        border:1px solid var(--line); border-radius:20px; padding:6px 12px; font-size:11.5px;
        cursor:pointer; font-family:'Noto Sans JP', sans-serif; font-weight:700; white-space:nowrap;
      }
      .pill-btn:hover{background:var(--navy); color:#f2ebd8; border-color:var(--navy);}
      .pill-btn.admin{color:var(--gold); border-color:var(--gold);}
      .pill-btn.admin:hover{background:var(--gold); color:#fff;}

      .receipt-card{
        background:var(--panel); border:1px solid var(--line); border-radius:8px;
        padding:26px 24px; text-align:center; position:relative;
      }
      .receipt-greeting{font-size:15px; color:var(--ink); margin:0 0 16px 0; font-weight:500;}
      .receipt-rule{border-top:2px dashed var(--line); margin:0;}
      .receipt-label{font-size:12px; color:#7a7259; letter-spacing:.1em; margin:18px 0 6px 0;}
      .receipt-balance{
        font-family:'Courier Prime', monospace; font-size:32px; font-weight:700; color:var(--navy);
        margin:0 0 18px 0; letter-spacing:.01em;
      }
      .receipt-balance span{font-size:15px; font-family:'Noto Sans JP', sans-serif; color:#7a7259; margin-left:4px;}
      .receipt-actions{display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-top:20px;}
      .action-btn{
        background:var(--navy); color:#f2ebd8; border:none; padding:13px 0; border-radius:5px;
        font-size:13.5px; font-weight:700; cursor:pointer; font-family:'Noto Sans JP', sans-serif; letter-spacing:.03em;
      }
      .action-btn:hover{background:var(--navy-dark);}
      .history-link{
        display:inline-flex; align-items:center; gap:5px; background:none; border:none; margin-top:18px;
        color:#7a7259; font-size:12px; cursor:pointer; font-family:'Noto Sans JP', sans-serif;
      }
      .history-link:hover{color:var(--navy);}

      .sub-panel{
        background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:20px 20px 22px;
        background-image:repeating-linear-gradient(var(--panel) 0 27px, var(--line) 27px 28px);
        background-position:0 46px; position:relative; min-height:260px;
      }
      .back-btn{
        display:flex; align-items:center; gap:6px; background:none; border:none; color:var(--navy);
        font-size:12.5px; font-weight:700; cursor:pointer; font-family:'Noto Sans JP', sans-serif;
        margin-bottom:14px; padding:0;
      }
      .back-btn:hover{text-decoration:underline;}
      .section-title{font-family:'Shippori Mincho', serif; font-size:16px; color:var(--navy); margin:0 0 14px 0; font-weight:700;}
      .btn{
        display:inline-flex; align-items:center; gap:7px; background:var(--navy); color:#f2ebd8; border:none;
        padding:10px 18px; border-radius:4px; font-size:13px; cursor:pointer; font-family:'Noto Sans JP', sans-serif;
        font-weight:700; letter-spacing:.02em;
      }
      .btn:hover{background:var(--navy-dark);}
      .btn.danger{background:var(--hanko);}
      .btn.danger:hover{background:#8f2b21;}
      .btn-row{display:flex; gap:10px; margin-top:6px;}
      .empty-note{font-size:13px; color:#8a8270; padding:12px 0;}
      .not-admin-note{font-size:13px; color:#6b6355; line-height:1.7;}
      .helper-note{font-size:12px; color:#7a7259; margin:-6px 0 14px 0;}
      .notice-note{
        font-size:12.5px; color:var(--sage); background:#eef1e8; border:1px solid #cdd8c4;
        border-radius:4px; padding:8px 11px; margin-bottom:12px;
      }
      .sub-title{font-family:'Shippori Mincho', serif; font-size:14px; color:var(--navy); margin:0 0 10px 0; font-weight:700;}

      .request-list{display:flex; flex-direction:column; gap:10px; margin-bottom:6px;}
      .request-row{background:#fff; border:1px solid var(--line); border-radius:5px; padding:10px 12px;}
      .request-main{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
      .request-name{font-size:13px; font-weight:700; color:var(--ink);}
      .request-amt{font-family:'Courier Prime', monospace; font-size:13px; color:var(--navy); margin-left:auto;}
      .request-memo{font-size:11.5px; color:#8a8270; margin:5px 0 8px 0;}

      .request-history{margin-top:18px; border-top:1px dashed var(--line); padding-top:14px;}
      .request-history-title{font-size:12px; color:#7a7259; margin:0 0 8px 0; letter-spacing:.03em;}
      .request-history-row{display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 0; border-bottom:1px solid #eee3c8;}
      .req-status{margin-left:auto; font-size:10.5px; padding:2px 8px; border-radius:9px; font-weight:700;}
      .req-status.req-pending{background:#f3e6c7; color:#8a6a1f;}
      .req-status.req-approved{background:#e0e9dd; color:var(--sage);}
      .req-status.req-rejected{background:#f2dcd8; color:var(--hanko);}

      .ledger-table{width:100%; border-collapse:collapse; font-size:11.5px;}
      .ledger-table th{
        text-align:left; font-weight:700; color:#6b6355; font-size:10.5px; letter-spacing:.05em;
        padding:0 6px 8px 6px; border-bottom:1px solid var(--line);
      }
      .ledger-table td{padding:7px 6px; border-bottom:1px solid #eee3c8; vertical-align:top;}
      .ledger-table .amt{font-family:'Courier Prime', monospace; text-align:right; white-space:nowrap;}
      .amt.plus{color:var(--sage);}
      .amt.minus{color:var(--hanko);}
      .type-chip{font-size:10px; padding:2px 7px; border-radius:9px; border:1px solid var(--line); color:#6b6355; white-space:nowrap;}
      .table-scroll{overflow-x:auto;}

      .hanko-wrap{
        position:absolute; top:10px; right:14px; opacity:0; transform:scale(1.8) rotate(-16deg);
        transition:opacity .35s ease-out; pointer-events:none;
      }
      .hanko-wrap.hanko-show{ animation:stampIn .38s cubic-bezier(.2,1.4,.4,1) forwards; }
      @keyframes stampIn{
        0%{opacity:0; transform:scale(1.9) rotate(-18deg);}
        55%{opacity:1; transform:scale(0.92) rotate(-7deg);}
        100%{opacity:1; transform:scale(1) rotate(-6deg);}
      }

      .loading-note{font-size:13px; color:#7a7259; text-align:center; padding:40px 0;}

      @media (max-width:420px){
        .receipt-balance{font-size:26px;}
        .action-btn{font-size:12px; padding:11px 0;}
        .form-grid{grid-template-columns:1fr;}
      }
    `}</style>
  );

  // ---------- LOADING ----------
  if (!authReady) {
    return (
      <div className="bank-app">
        {sharedStyle}
        <p className="loading-note">読み込み中...</p>
      </div>
    );
  }

  // ---------- LOGIN / SIGNUP ----------
  if (!authUser) {
    return (
      <div className="bank-app">
        {sharedStyle}
        <div className="auth-wrap">
          <p className="auth-title">CZ Bank</p>
          <div className="auth-sub">Open Chat Community Bank</div>
          <div className="auth-divider" />

          {screen === "login" ? (
            <div className="auth-form">
              {loginError && <div className="err-note">{loginError}</div>}
              <div className="form-row">
                <label>メールアドレス</label>
                <input
                  type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="例: taro@example.com" autoFocus
                />
              </div>
              <div className="form-row">
                <label>パスワード</label>
                <input
                  type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                />
              </div>
              <button type="button" className="auth-btn" onClick={handleLogin}>ログイン</button>
              <p className="auth-note">※OC内専用銀行</p>
              <div className="auth-switch">
                口座をお持ちでない方は{" "}
                <button type="button" className="link-btn" onClick={() => { setScreen("signup"); setSuError(""); }}>
                  ＋ 新規作成
                </button>
              </div>
            </div>
          ) : (
            <div className="auth-form">
              {suError && <div className="err-note">{suError}</div>}
              <div className="form-row">
                <label>表示名（ニックネーム）</label>
                <input value={suName} onChange={(e) => setSuName(e.target.value)} placeholder="例: 銀次郎" />
              </div>
              <div className="form-row">
                <label>メールアドレス</label>
                <input type="email" value={suEmail} onChange={(e) => setSuEmail(e.target.value)} placeholder="例: ginjiro@example.com" />
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>パスワード</label>
                  <input type="password" value={suPw} onChange={(e) => setSuPw(e.target.value)} placeholder="6文字以上" />
                </div>
                <div className="form-row">
                  <label>パスワード（確認）</label>
                  <input type="password" value={suPw2} onChange={(e) => setSuPw2(e.target.value)} placeholder="再入力" />
                </div>
              </div>
              <button type="button" className="auth-btn" onClick={handleSignup}>新規口座を開設する</button>
              <p className="auth-note">開設時の残高は0{CURRENCY}です。管理者が残高を付与できます。</p>
              <div className="auth-switch">
                <button type="button" className="link-btn" onClick={() => { setScreen("login"); setLoginError(""); }}>
                  ← ログイン画面へ戻る
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- PROFILE STILL LOADING ----------
  if (!profile) {
    return (
      <div className="bank-app">
        {sharedStyle}
        <p className="loading-note">アカウント情報を読み込み中...</p>
      </div>
    );
  }

  // ---------- POST-LOGIN SHELL ----------
  return (
    <div className="bank-app">
      {sharedStyle}

      <div className="topbar">
        <span className="topbar-logo">CZ Bank</span>
        <div className="topbar-actions">
          {isAdmin && appScreen !== "admin" && (
            <button className="pill-btn admin" onClick={() => setAppScreen("admin")}>管理者画面 →</button>
          )}
          <button className="pill-btn" onClick={handleLogout}><LogOut size={13} /> ログアウト</button>
        </div>
      </div>

      {appScreen === "home" && (
        <div className="receipt-card">
          <HankoStamp show={showStamp} />
          <p className="receipt-greeting">こんにちは、{profile.name}さん</p>
          <div className="receipt-rule" />
          <p className="receipt-label">普通預金</p>
          <p className="receipt-balance">{profile.balance.toLocaleString()}<span>{CURRENCY}</span></p>
          <div className="receipt-rule" />
          <div className="receipt-actions">
            <button className="action-btn" onClick={() => { setAppScreen("transfer"); setXferTo(transferTargets[0]?.uid || ""); }}>送金</button>
            <button className="action-btn" onClick={() => setAppScreen("deposit")}>入金</button>
            <button className="action-btn" onClick={() => setAppScreen("withdraw")}>出金</button>
          </div>
          <button className="history-link" onClick={() => setAppScreen("history")}>
            <History size={13} /> 取引明細を見る
          </button>
        </div>
      )}

      {appScreen === "transfer" && (
        <div className="sub-panel">
          <HankoStamp show={showStamp} />
          <button className="back-btn" onClick={goHome}><ArrowLeft size={13} /> ホームに戻る</button>
          <h3 className="section-title">送金</h3>
          <div>
            {xferError && <div className="err-note">{xferError}</div>}
            <div className="form-row">
              <label>送金先</label>
              <select value={xferTo} onChange={(e) => setXferTo(e.target.value)}>
                {transferTargets.map((a) => (
                  <option key={a.uid} value={a.uid}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>金額 ({CURRENCY})</label>
                <input type="number" min="1" value={xferAmt} onChange={(e) => setXferAmt(e.target.value)} placeholder="例: 100" />
              </div>
              <div className="form-row">
                <label>メモ（任意）</label>
                <input value={xferMemo} onChange={(e) => setXferMemo(e.target.value)} placeholder="例: イベント参加賞" />
              </div>
            </div>
            <div className="btn-row"><button type="button" className="btn" onClick={handleTransfer}>送金する</button></div>
          </div>
        </div>
      )}

      {appScreen === "deposit" && (
        <div className="sub-panel">
          <HankoStamp show={showStamp} />
          <button className="back-btn" onClick={goHome}><ArrowLeft size={13} /> ホームに戻る</button>
          <h3 className="section-title">入金申請</h3>
          <p className="helper-note">申請後、管理者が承認すると残高に反映されます。</p>
          <div>
            {depositError && <div className="err-note">{depositError}</div>}
            {depositNotice && <div className="notice-note">{depositNotice}</div>}
            <div className="form-grid">
              <div className="form-row">
                <label>金額 ({CURRENCY})</label>
                <input
                  type="number" min="1" value={depositAmt}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDeposit()}
                  placeholder="例: 500"
                />
              </div>
              <div className="form-row">
                <label>メモ（任意）</label>
                <input
                  value={depositMemo} onChange={(e) => setDepositMemo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDeposit()}
                  placeholder="例: ATM入金"
                />
              </div>
            </div>
            <div className="btn-row"><button type="button" className="btn" onClick={handleDeposit}>入金を申請する</button></div>
          </div>
          <RequestHistory requests={requests} accountUid={authUser.uid} />
        </div>
      )}

      {appScreen === "withdraw" && (
        <div className="sub-panel">
          <HankoStamp show={showStamp} />
          <button className="back-btn" onClick={goHome}><ArrowLeft size={13} /> ホームに戻る</button>
          <h3 className="section-title">出金申請</h3>
          <p className="helper-note">申請後、管理者が承認すると残高から引き落とされます。</p>
          <div>
            {withdrawError && <div className="err-note">{withdrawError}</div>}
            {withdrawNotice && <div className="notice-note">{withdrawNotice}</div>}
            <div className="form-grid">
              <div className="form-row">
                <label>金額 ({CURRENCY})</label>
                <input
                  type="number" min="1" value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleWithdraw()}
                  placeholder="例: 300"
                />
              </div>
              <div className="form-row">
                <label>メモ（任意）</label>
                <input
                  value={withdrawMemo} onChange={(e) => setWithdrawMemo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleWithdraw()}
                  placeholder="例: ATM出金"
                />
              </div>
            </div>
            <div className="btn-row"><button type="button" className="btn" onClick={handleWithdraw}>出金を申請する</button></div>
          </div>
          <RequestHistory requests={requests} accountUid={authUser.uid} />
        </div>
      )}

      {appScreen === "admin" && (
        <div className="sub-panel">
          <HankoStamp show={showStamp} />
          <button className="back-btn" onClick={goHome}><ArrowLeft size={13} /> ホームに戻る</button>
          <h3 className="section-title">管理者画面</h3>
          {!isAdmin ? (
            <p className="not-admin-note">この機能は管理者権限のアカウントのみ利用できます。</p>
          ) : (
            <>
              {adminError && <div className="err-note">{adminError}</div>}

              <h4 className="sub-title">入出金申請の承認</h4>
              {pendingRequests.length === 0 ? (
                <p className="empty-note">現在、承認待ちの申請はありません。</p>
              ) : (
                <div className="request-list">
                  {pendingRequests.map((r) => (
                    <div key={r.id} className="request-row">
                      <div className="request-main">
                        <span className="type-chip">{r.type === "deposit" ? "入金" : "出金"}</span>
                        <span className="request-name">{r.accountName}</span>
                        <span className="request-amt">{r.amount.toLocaleString()} {CURRENCY}</span>
                      </div>
                      <div className="request-memo">{r.memo}（申請: {fmtTs(r.ts)}）</div>
                      <div className="btn-row">
                        <button className="btn" type="button" onClick={() => approveRequest(r)}>承認する</button>
                        <button className="btn danger" type="button" onClick={() => rejectRequest(r)}>却下する</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="sub-title" style={{ marginTop: 22 }}>通貨の発行・没収</h4>
              <div className="form-grid">
                <div className="form-row">
                  <label>対象アカウント</label>
                  <select value={adminTarget} onChange={(e) => setAdminTarget(e.target.value)}>
                    <option value="">選択してください</option>
                    {adminTargets.map((a) => (
                      <option key={a.uid} value={a.uid}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>金額 ({CURRENCY})</label>
                  <input type="number" min="1" value={adminAmt} onChange={(e) => setAdminAmt(e.target.value)} placeholder="例: 500" />
                </div>
              </div>
              <div className="form-row">
                <label>理由・メモ</label>
                <input value={adminReason} onChange={(e) => setAdminReason(e.target.value)} placeholder="例: イベント優勝賞金 / 規約違反による没収" />
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => handleAdmin("issue")} type="button">発行する</button>
                <button className="btn danger" onClick={() => handleAdmin("confiscate")} type="button">没収する</button>
              </div>
            </>
          )}
        </div>
      )}

      {appScreen === "history" && (
        <div className="sub-panel">
          <button className="back-btn" onClick={goHome}><ArrowLeft size={13} /> ホームに戻る</button>
          <h3 className="section-title">取引明細（新しい順）</h3>
          {txLog.length === 0 ? (
            <p className="empty-note">まだ取引がありません。</p>
          ) : (
            <div className="table-scroll">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>日時</th><th>種別</th><th>From</th><th>To</th><th style={{ textAlign: "right" }}>金額</th><th>メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {txLog.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtTs(l.ts)}</td>
                      <td><span className="type-chip">{TYPE_LABEL[l.type] || l.type}</span></td>
                      <td>{l.fromName}</td>
                      <td>{l.toName}</td>
                      <td className={"amt " + (MINUS_TYPES.includes(l.type) ? "minus" : "plus")}>
                        {MINUS_TYPES.includes(l.type) ? "-" : "+"}{l.amount.toLocaleString()} {CURRENCY}
                      </td>
                      <td>{l.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
