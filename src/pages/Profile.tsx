import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function Profile() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { setLoading(false); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name,bio")
        .eq("id", uid)
        .single();
      if (!error && data) {
        setFullName(data.full_name || "");
        setBio(data.bio || "");
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setMsg("");
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setMsg("Not authenticated"); return; }
    const { error } = await supabase.from("profiles").upsert({
      id: uid,
      full_name: fullName || null,
      bio: bio || null
    });
    if (error) { setMsg(error.message); return; }
    setMsg("Saved");
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <button onClick={()=>nav("/")} className="rounded border px-3 py-2">Back</button>
      </div>

      <label className="grid gap-1">
        <span className="text-sm">Full name</span>
        <input className="border p-2 rounded" value={fullName} onChange={e=>setFullName(e.target.value)} />
      </label>

      <label className="grid gap-1">
        <span className="text-sm">Bio</span>
        <textarea className="border p-2 rounded" rows={3} value={bio} onChange={e=>setBio(e.target.value)} />
      </label>

      <div className="flex items-center gap-2">
        <button onClick={save} className="rounded bg-black text-white px-3 py-2">Save</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  );
}
