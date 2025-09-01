import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { analyzeMedia, warmUpPose, startLiveOverlay } from "../lib/pose";

const FALLBACK_MOVES = ["Squat", "Plank", "Side Bend"];
const RECORD_DELAY = 3;
const PHOTO_DELAY = 2;

export default function NewAssessment() {
  const nav = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stopOverlayRef = useRef<(() => void) | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [moves, setMoves] = useState<string[]>(FALLBACK_MOVES);
  const [movement, setMovement] = useState(FALLBACK_MOVES[0]);
  const [recording, setRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);

  const stopCamera = () => {
    try { if (recRef.current && recRef.current.state === "recording") recRef.current.stop(); } catch {}
    stopOverlayRef.current?.(); stopOverlayRef.current = null;
    const s = streamRef.current || (videoRef.current?.srcObject as MediaStream | null);
    s?.getTracks().forEach(t => t.stop());
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    streamRef.current = null;
  };

  useEffect(() => { warmUpPose(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const isNarrow = window.matchMedia("(max-width: 640px)").matches;
        const constraints: MediaStreamConstraints = {
          video: isNarrow
            ? { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 }, aspectRatio: 3 / 4, frameRate: { max: 24 } }
            : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: 4 / 3, frameRate: { max: 24 } },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          if (overlayRef.current) {
            stopOverlayRef.current?.();
            stopOverlayRef.current = await startLiveOverlay(videoRef.current, overlayRef.current);
          }
        }
      } catch {
        setMsg("Camera unavailable. Use Upload or Photo.");
      }
    })();
    return () => { stopCamera(); };
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("movement_types").select("name").order("name", { ascending: true });
      if (data?.length) {
        const list = data.map(d => d.name);
        setMoves(list);
        setMovement(list[0]);
      }
    })();
  }, []);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const runCountdown = async (sec: number) => {
    for (let s = sec; s > 0; s--) {
      setCountdown(s);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(null);
  };

  const start = async () => {
    if (!streamRef.current || !videoRef.current?.srcObject) return;
    const mime = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
    if (!("MediaRecorder" in window) || !mime) { setMsg("Recording not supported. Use Upload or Photo."); return; }
    await runCountdown(RECORD_DELAY);
    const rec = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 600_000 });
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return url; });
      setPreviewMime("video/webm");
    };
    rec.start();
    recRef.current = rec;
    setRecording(true);
    setTimeout(() => stop(), 10000);
  };

  const stop = () => {
    try { recRef.current?.stop(); } catch {}
    setRecording(false);
  };

  const capturePhoto = async () => {
    const v = videoRef.current;
    if (!v) return;
    await runCountdown(PHOTO_DELAY);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 720;
    canvas.height = v.videoHeight || 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), "image/webp", 0.92));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return url; });
    setPreviewMime("image/webp");
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!f.type.startsWith("video/") && !f.type.startsWith("image/")) { setMsg("Unsupported file."); return; }
    const url = URL.createObjectURL(f);
    setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return url; });
    setPreviewMime(f.type);
  };

  const save = async () => {
    if (!previewUrl) { setMsg("No media to save"); return; }
    setBusy(true); setMsg("");

    const blob = await (await fetch(previewUrl)).blob();
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) { setBusy(false); setMsg("Not authenticated"); return; }

    const guessed = previewMime || blob.type || "application/octet-stream";
    const ext = guessed.startsWith("video/") ? "webm" : (guessed.split("/")[1] || "bin");
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;

    const [ai, up] = await Promise.all([
      analyzeMedia({ url: previewUrl, mime: guessed }, movement),
      supabase.storage.from("assessments").upload(path, blob, { contentType: guessed })
    ]);

    if ((up as any).error) { setBusy(false); setMsg((up as any).error.message); return; }

    const payload: Record<string, any> = {
      user_id: uid,
      movement_type: movement,
      score: (ai as any).score,
      feedback: (ai as any).feedback,
      media_url: path
    };
    if ((ai as any).analysis) payload.analysis = (ai as any).analysis;

    const { error: insErr } = await supabase.from("assessments").insert(payload);
    if (insErr) { setBusy(false); setMsg(insErr.message); return; }

    setBusy(false);
    stopCamera();
    nav("/");
  };

  const controlsDisabled = recording || countdown !== null || busy;

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">New Assessment</h1>
          <div className="mt-2">
            <label className="mr-2">Movement</label>
            <select value={movement} onChange={e => setMovement(e.target.value)} className="border p-2 rounded">
              {moves.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <button onClick={() => { stopCamera(); nav("/"); }} className="rounded border px-3 py-2">Back</button>
      </div>

      <div className="grid gap-4 md:gap-6 md:grid-cols-2">
        <div className="border rounded-lg p-3">
          <div className="relative w-full rounded overflow-hidden bg-black aspect-[3/4] md:aspect-[4/3]">
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full pointer-events-none" />
            {countdown !== null && (
              <div className="absolute inset-0 grid place-items-center bg-black/40">
                <div className="text-white text-5xl md:text-6xl font-semibold">{countdown}</div>
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button onClick={start} disabled={controlsDisabled} className="col-span-2 sm:col-span-1 rounded bg-black text-white px-4 py-3 text-base sm:text-sm disabled:opacity-50">Record 10s</button>
            <button onClick={stop} disabled={!recording || busy} className="rounded border px-4 py-3 text-base sm:text-sm">Stop</button>
            <button onClick={capturePhoto} disabled={controlsDisabled} className="rounded border px-4 py-3 text-base sm:text-sm">Photo</button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded border px-4 py-3 text-base sm:text-sm">Upload</button>
            <input ref={fileRef} type="file" accept="video/*,image/*" hidden onChange={onPick} />
          </div>
          {msg && <p className="mt-2 text-sm">{msg}</p>}
        </div>

        <div className="border rounded-lg p-3">
          <div className="w-full rounded border overflow-hidden bg-gray-50 aspect-[3/4] md:aspect-[4/3] grid place-items-center">
            {previewUrl ? (
              previewMime?.startsWith("video/")
                ? <video src={previewUrl} controls className="h-full w-full object-contain" />
                : <img src={previewUrl} className="h-full w-full object-contain" />
            ) : (
              <div className="text-sm text-gray-500">No preview yet</div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={save} disabled={!previewUrl || busy} className="col-span-2 sm:col-span-1 rounded bg-black text-white px-4 py-3 text-base sm:text-sm disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
            <button onClick={() => { setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; }); setPreviewMime(undefined); }} disabled={!previewUrl || busy} className="rounded border px-4 py-3 text-base sm:text-sm">Clear</button>
          </div>
        </div>
      </div>

      <div className="fixed bottom-[max(env(safe-area-inset-bottom),12px)] left-0 right-0 z-30 md:hidden">
        <div className="mx-auto max-w-6xl px-4">
          <div className="rounded-xl shadow-lg bg-white border p-2 flex gap-2">
            <button onClick={save} disabled={!previewUrl || busy} className="flex-1 rounded bg-black text-white py-3">{busy ? "Saving..." : "Save"}</button>
            <button onClick={() => { setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; }); setPreviewMime(undefined); }} disabled={!previewUrl || busy} className="rounded border px-4 py-3">Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}
