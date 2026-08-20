import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Activity, KeyRound, LogOut, Plus, RefreshCw, ShieldCheck, UserCog, Users } from "lucide-react";
import { FormEvent, useState } from "react";

function formatTime(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function AdminConsole() {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const overview = trpc.admin.workOverview.useQuery(undefined, { refetchInterval: 5000 });
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [credentialTarget, setCredentialTarget] = useState<{ userId: number; username: string | null; mode: "username" | "password" } | null>(null);
  const [credentialValue, setCredentialValue] = useState("");
  const createWorker = trpc.admin.createWorker.useMutation({ onSuccess: async () => { setUsername(""); setDisplayName(""); setPassword(""); await utils.admin.workOverview.invalidate(); } });
  const updateWorker = trpc.admin.updateWorker.useMutation({ onSuccess: () => utils.admin.workOverview.invalidate() });
  const changePassword = trpc.auth.changePassword.useMutation({ onSuccess: () => { setCurrentPassword(""); setNewPassword(""); } });

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    await createWorker.mutateAsync({ username, displayName: displayName || undefined, password });
  }
  async function changeOwnPassword(event: FormEvent) {
    event.preventDefault();
    await changePassword.mutateAsync({ currentPassword, newPassword });
  }
  function resetWorkerPassword(userId: number, username: string | null) {
    setCredentialTarget({ userId, username, mode: "password" });
    setCredentialValue("");
  }
  function renameWorker(userId: number, username: string | null) {
    setCredentialTarget({ userId, username, mode: "username" });
    setCredentialValue(username || "");
  }
  async function saveWorkerCredential(event: FormEvent) {
    event.preventDefault();
    if (!credentialTarget) return;
    await updateWorker.mutateAsync(credentialTarget.mode === "username"
      ? { userId: credentialTarget.userId, username: credentialValue }
      : { userId: credentialTarget.userId, password: credentialValue });
    setCredentialTarget(null);
    setCredentialValue("");
  }

  const accounts = overview.data?.accounts ?? [];
  const recentFiles = overview.data?.recentFiles ?? [];
  const filteredFiles = accountFilter === "all" ? recentFiles : recentFiles.filter(file => String(file.userId) === accountFilter);
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3"><div className="rounded-lg bg-blue-600 p-2 text-white"><ShieldCheck className="w-5 h-5" /></div><div><h1 className="font-semibold">切音工具 · 管理员控制台</h1><p className="text-xs font-mono text-slate-500">管理员：{user?.username}</p></div></div>
        <button onClick={() => logout()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"><LogOut className="w-4 h-4" />退出</button>
      </header>
      <div className="mx-auto max-w-7xl p-5 lg:p-8 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 font-semibold"><Plus className="w-4 h-4 text-blue-600" />分配 worker 账号</div><form onSubmit={createAccount} className="mt-4 space-y-3"><input value={username} onChange={e => setUsername(e.target.value)} required placeholder="登录账号，如 worker_01" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="显示名称（可选）" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={password} onChange={e => setPassword(e.target.value)} required minLength={8} type="password" placeholder="初始密码（至少8位）" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />{createWorker.error && <p className="text-xs text-red-600">{createWorker.error.message}</p>}<button disabled={createWorker.isPending} className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-60">创建并分配</button></form></section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 font-semibold"><KeyRound className="w-4 h-4 text-blue-600" />修改管理员密码</div><form onSubmit={changeOwnPassword} className="mt-4 space-y-3"><input value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required type="password" placeholder="当前密码" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} type="password" placeholder="新密码（至少8位）" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />{changePassword.error && <p className="text-xs text-red-600">{changePassword.error.message}</p>}<button className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">保存新密码</button></form></section>
        </aside>
        <section className="space-y-6">
          <div className="flex items-center justify-between"><div><p className="font-mono text-xs text-blue-600">LIVE WORK OVERVIEW</p><h2 className="text-xl font-semibold mt-1">worker 实时作业总览</h2></div><button onClick={() => overview.refetch()} className="rounded-lg border border-slate-300 p-2 hover:bg-white" title="刷新"><RefreshCw className={`w-4 h-4 ${overview.isFetching ? "animate-spin" : ""}`} /></button></div>
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"><div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 font-semibold"><Users className="w-4 h-4 text-blue-600" />账号与作业状态</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 text-left">账号</th><th className="px-3 py-3 text-left">状态</th><th className="px-3 py-3 text-right">音频</th><th className="px-3 py-3 text-right">片段</th><th className="px-5 py-3 text-left">最近作业</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody>{accounts.map(account => <tr key={account.id} className="border-t border-slate-100"><td className="px-5 py-3"><div className="font-medium">{account.name || account.username}</div><div className="font-mono text-xs text-slate-500">{account.username}</div></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs ${account.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{account.role === "admin" ? "管理员" : account.isActive ? "可作业" : "已停用"}</span></td><td className="px-3 py-3 text-right font-mono">{account.audioCount}</td><td className="px-3 py-3 text-right font-mono">{account.segmentCount}</td><td className="px-5 py-3 text-xs text-slate-500">{formatTime(account.latestWorkAt)}</td><td className="px-5 py-3 text-right"><div className="inline-flex gap-3">{account.role !== "admin" && <><button onClick={() => renameWorker(account.id, account.username)} className="text-xs text-blue-600 hover:underline">修改账号</button><button onClick={() => resetWorkerPassword(account.id, account.username)} className="text-xs text-blue-600 hover:underline">重置密码</button><button onClick={() => updateWorker.mutate({ userId: account.id, isActive: !account.isActive })} className="text-xs text-blue-600 hover:underline">{account.isActive ? "停用" : "启用"}</button></>}</div></td></tr>)}</tbody></table>{accounts.length === 0 && <div className="p-8 text-center text-sm text-slate-500">尚无账号</div>}</div></section>
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"><div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 font-semibold"><span className="flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" />全部账号的最近上传</span><select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-normal"><option value="all">全部账号</option>{accounts.filter(account => account.role !== "admin").map(account => <option key={account.id} value={String(account.id)}>{account.name || account.username}</option>)}</select></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 text-left">文件</th><th className="px-3 py-3 text-left">worker</th><th className="px-3 py-3 text-right">时长</th><th className="px-5 py-3 text-left">更新时间</th></tr></thead><tbody>{filteredFiles.map(file => <tr key={file.id} className="border-t border-slate-100"><td className="px-5 py-3 font-medium">{file.originalName}</td><td className="px-3 py-3 text-slate-600">{file.workerName || file.username}</td><td className="px-3 py-3 text-right font-mono">{(file.durationMs / 1000).toFixed(3)}s</td><td className="px-5 py-3 text-xs text-slate-500">{formatTime(file.updatedAt)}</td></tr>)}</tbody></table>{filteredFiles.length === 0 && <div className="p-8 text-center text-sm text-slate-500">该账号暂无作业结果</div>}</div></section>
        </section>
      </div>
      {credentialTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={saveWorkerCredential} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"><h3 className="font-semibold">{credentialTarget.mode === "username" ? "修改 worker 登录账号" : "重置 worker 密码"}</h3><p className="mt-1 text-sm text-slate-500">账号：{credentialTarget.username}</p><input value={credentialValue} onChange={e => setCredentialValue(e.target.value)} type={credentialTarget.mode === "password" ? "password" : "text"} minLength={credentialTarget.mode === "password" ? 8 : 3} pattern={credentialTarget.mode === "username" ? "[a-z0-9][a-z0-9._-]{2,63}" : undefined} required placeholder={credentialTarget.mode === "password" ? "新密码（至少8位）" : "新的登录账号"} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />{updateWorker.error && <p className="mt-2 text-xs text-red-600">{updateWorker.error.message}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setCredentialTarget(null)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button><button disabled={updateWorker.isPending} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60">保存</button></div></form></div>}
    </main>
  );
}
