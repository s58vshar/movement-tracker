import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

type Row = { id:string; movement_type:string; score:number; feedback:string; created_at:string; media_url:string; analysis?: { coverage?: number; metrics?: Record<string, number>; notes?: string[] }; };

export default function Dashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [signed, setSigned] = useState<Record<string,string>>({});
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const session = await supabase.auth.getSession();
      const user = session.data.session?.user;
      setEmail(user?.email || "");

      const { data, error } = await supabase
        .from("assessments")
        .select("id,movement_type,score,feedback,created_at,media_url,analysis")
        .order("created_at", { ascending: false });

      if (error) setErr(error.message);
      if (data) {
        setRows(data as Row[]);
        const sigs: Record<string,string> = {};
        for (const r of data as Row[]) {
          const { data: urlData } = await supabase.storage.from("assessments").createSignedUrl(r.media_url, 60*10);
          if (urlData?.signedUrl) sigs[r.id] = urlData.signedUrl;
        }
        setSigned(sigs);
      }
      setLoading(false);
    })();
  }, []);

  const chart = [...rows].reverse().map(r => ({ date: new Date(r.created_at).toLocaleDateString(), score: r.score }));

  const onDelete = async (r: Row) => {
    if (!confirm("Delete this assessment?")) return;
    setErr("");
    setBusyId(r.id);

    // 1) Try to delete object; if it 404s, continue
    const { error: delObjErr } = await supabase.storage.from("assessments").remove([r.media_url]);
    if (delObjErr && !/not.*found/i.test(delObjErr.message)) {
      setBusyId(null);
      setErr(delObjErr.message);
      return;
    }

    // 2) Delete DB row
    const { error: delRowErr } = await supabase.from("assessments").delete().eq("id", r.id);
    if (delRowErr) {
      setBusyId(null);
      setErr(delRowErr.message);
      return;
    }

    // 3) Update UI
    setRows(prev => prev.filter(x => x.id !== r.id));
    setSigned(prev => {
      const n = { ...prev };
      delete n[r.id];
      return n;
    });
    setBusyId(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-600">{email}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/profile" className="rounded border px-3 py-2">Profile</a>
          <Link to="/new" className="rounded bg-black text-white px-3 py-2">New Assessment</Link>
          <button onClick={() => supabase.auth.signOut()} className="rounded border px-3 py-2">Sign out</button>
        </div>
      </div>

      <div className="h-64 border rounded p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart}>
            <XAxis dataKey="date" />
            <YAxis domain={[0,10]} />
            <Tooltip />
            <Line type="monotone" dataKey="score" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {loading && <div className="text-sm">Loading...</div>}
      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.id} className="border rounded p-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="font-medium">{r.movement_type} • Score {r.score}</div>
              <div className="text-sm text-gray-600">{new Date(r.created_at).toLocaleString()}</div>
              <div className="text-sm">{r.feedback}</div>
              {r.analysis && (
                <div className="text-xs text-gray-600 mt-1">
                coverage {typeof r.analysis.coverage === "number" ? r.analysis.coverage : "-"} • {JSON.stringify(r.analysis.metrics || {})}</div>
)}
              <div className="mt-2">
                <button
                  onClick={() => onDelete(r)}
                  disabled={busyId === r.id}
                  className="rounded border px-3 py-2 disabled:opacity-50"
                >
                  {busyId === r.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
            <div className="justify-self-end">
              {signed[r.id] && (signed[r.id].includes(".webm")
                ? <video src={signed[r.id]} controls className="w-48 rounded border" />
                : <img src={signed[r.id]} className="w-48 rounded border" />)}
            </div>
          </div>
        ))}
        {rows.length === 0 && !loading && <p className="text-sm">No assessments yet.</p>}
      </div>
    </div>
  );
}
