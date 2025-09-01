import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import * as posed from "@tensorflow-models/pose-detection";

let detectorPromise: Promise<posed.PoseDetector> | null = null;

type XY = { x:number; y:number; score?:number };
type Preview = { url: string; mime?: string };

const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const std=(a:number[])=>{ if(!a.length) return 0; const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); };

function ang(a: XY, b: XY, c: XY){
  const ab={x:a.x-b.x,y:a.y-b.y}, cb={x:c.x-b.x,y:c.y-b.y};
  const dot=ab.x*cb.x+ab.y*cb.y, mab=Math.hypot(ab.x,ab.y), mcb=Math.hypot(cb.x,cb.y);
  const cos=Math.min(1,Math.max(-1,dot/((mab*mcb)||1))); 
  return Math.acos(cos)*180/Math.PI;
}
function lineAngle(p1:XY,p2:XY){ return Math.atan2(p2.y-p1.y,p2.x-p1.x)*180/Math.PI; }
function kp(obj: posed.Keypoint[]|undefined, name:string, idx?:number): XY | null{
  if(!obj) return null; const byName = obj.find(k => (k as any).name===name) as any;
  if(byName) return { x:byName.x, y:byName.y, score:byName.score };
  if(idx==null) return null; const k=obj[idx]; if(!k) return null; return {x:k.x,y:k.y,score:(k as any).score};
}

async function getDetector(){
  if(!detectorPromise){
    detectorPromise=(async()=>{ 
      await tf.setBackend("webgl"); 
      await tf.ready(); 
      return posed.createDetector(posed.SupportedModels.MoveNet,{ modelType:"SinglePose.Lightning", enableSmoothing:true }); 
    })();
  }
  return detectorPromise;
}

// function waitForVideo(el: HTMLVideoElement, url: string){
//   return new Promise<void>((resolve,reject)=>{
//     const onLoaded=()=>{ cleanup(); resolve(); };
//     const onErr=()=>{ cleanup(); reject(new Error("video load error")); };
//     const cleanup=()=>{ el.removeEventListener("loadedmetadata", onLoaded); el.removeEventListener("error", onErr); };
//     el.muted=true; el.playsInline=true; el.preload="auto"; el.src=url; el.load();
//     el.addEventListener("loadedmetadata", onLoaded, { once:true });
//     el.addEventListener("error", onErr, { once:true });
//   });
// }
function waitForImage(img: HTMLImageElement, url: string){
  return new Promise<void>((resolve,reject)=>{
    img.onload=()=>resolve(); img.onerror=()=>reject(new Error("image load error")); img.src=url;
  });
}

function scoreFromMetrics(movement:string, hip:number[], kL:number[], kR:number[], spine:number[], coverage:number){
  let score=5; const notes:string[]=[]; const metrics:Record<string,number>={};
  if(/plank/i.test(movement)){
    const hipMean=mean(hip), hipStab=std(hip), tilt=mean(spine);
    metrics.hipMean=+hipMean.toFixed(1); metrics.hipStd=+hipStab.toFixed(2); metrics.spineTilt=+tilt.toFixed(1);
    const s1=Math.max(0,10-Math.abs(180-hipMean)/4), s2=Math.max(0,10-hipStab*10), s3=coverage*10;
    score=Math.round(s1*0.5+s2*0.3+s3*0.2);
    if(hipMean<170) notes.push("Hips low"); if(hipMean>190) notes.push("Hips high"); if(hipStab>1.5) notes.push("Hold steady");
  } else if(/squat/i.test(movement)){
    const mk=((kL.length?Math.min(...kL):180)+(kR.length?Math.min(...kR):180))/2;
    const torso=mean(spine);
    metrics.minKnee=+mk.toFixed(1); metrics.torsoTilt=+torso.toFixed(1);
    const depth=Math.max(0,10-Math.abs(95-mk)/3), control=Math.max(0,10-std(kL.concat(kR))), s3=Math.max(0,10-torso/2), s4=coverage*10;
    score=Math.round(depth*0.5+control*0.2+s3*0.1+s4*0.2);
    if(mk>130) notes.push("Go deeper"); if(torso>20) notes.push("Keep chest up");
  } else if(/side\s*bend/i.test(movement)){
    const tilt=mean(spine); metrics.spineTilt=+tilt.toFixed(1);
    const stability=Math.max(0,10-std(spine)); score=Math.round(stability*0.6+coverage*10*0.4);
  } else {
    const stability=Math.max(0,10-std(hip)); score=Math.round(stability*0.6+coverage*10*0.4);
  }
  score=Math.min(10,Math.max(1,score));
  const feedback = notes.length?notes.join("; "):(score>=8?"Good form":score>=5?"Needs improvement":"Retake suggested");
  return { score, feedback, metrics, notes };
}

async function analyzeImage(url:string, movement:string){
  const det=await getDetector();
  const img=new Image();
  await waitForImage(img, url);
  const poses=await det.estimatePoses(img,{maxPoses:1}); const p=poses[0]?.keypoints;
  if(!p) return { score:4, feedback:"Pose not detected", analysis:{ frames:1, coverage:0, movement, metrics:{}, notes:["no pose"] } };
  const ls=kp(p,"left_shoulder",5), rs=kp(p,"right_shoulder",6), lh=kp(p,"left_hip",11), rh=kp(p,"right_hip",12);
  const lk=kp(p,"left_knee",13), rk=kp(p,"right_knee",14), la=kp(p,"left_ankle",15), ra=kp(p,"right_ankle",16);
  if(!(ls&&rs&&lh&&rh&&lk&&rk&&la&&ra)) return { score:4, feedback:"Keypoints low-confidence", analysis:{ frames:1, coverage:0.5, movement, metrics:{}, notes:["low confidence"] } };
  const midS={x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2}, midH={x:(lh.x+rh.x)/2,y:(lh.y+rh.y)/2}, midA={x:(la.x+ra.x)/2,y:(la.y+ra.y)/2};
  const spine = Math.abs(90 - Math.abs(lineAngle(midH as XY, midS as XY)));
  const hip = ang(midS as XY, midH as XY, midA as XY);
  const kLeft = ang(lh as XY, lk as XY, la as XY);
  const kRight = ang(rh as XY, rk as XY, ra as XY);
  const r = scoreFromMetrics(movement, [hip], [kLeft], [kRight], [spine], 1);
  return { score:r.score, feedback:r.feedback, analysis:{ frames:1, coverage:1, movement, metrics:r.metrics, notes:r.notes } };
}

export async function analyzeVideo(url: string, movement: string) {
  const det = await getDetector();
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url; v.load();

  // wait for metadata so duration is valid
  await new Promise<void>((res, rej) => {
    const onLoaded = () => { v.removeEventListener("loadedmetadata", onLoaded); res(); };
    const onErr = () => { v.removeEventListener("loadedmetadata", onLoaded); rej(new Error("video load error")); };
    v.addEventListener("loadedmetadata", onLoaded, { once: true });
    v.addEventListener("error", onErr, { once: true });
  });

  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  const N = 24;
  const denom = Math.max(1, N - 1);
  const hip: number[] = [], kL: number[] = [], kR: number[] = [], spine: number[] = [];

  if (dur === 0) {
    await v.play().catch(() => {});
    const poses = await det.estimatePoses(v, { maxPoses: 1 });
    const p = poses[0]?.keypoints;
    if (p) {
      const ls = kp(p, "left_shoulder", 5), rs = kp(p, "right_shoulder", 6);
      const lh = kp(p, "left_hip", 11), rh = kp(p, "right_hip", 12);
      const lk = kp(p, "left_knee", 13), rk = kp(p, "right_knee", 14);
      const la = kp(p, "left_ankle", 15), ra = kp(p, "right_ankle", 16);
      if (ls && rs && lh && rh && lk && rk && la && ra) {
        const midS = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const midH = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
        const midA = { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2 };
        spine.push(Math.abs(90 - Math.abs(lineAngle(midH as any, midS as any))));
        hip.push(ang(midS as any, midH as any, midA as any));
        kL.push(ang(lh as any, lk as any, la as any));
        kR.push(ang(rh as any, rk as any, ra as any));
      }
    }
    const r = scoreFromMetrics(movement, hip, kL, kR, spine, hip.length ? 1 : 0);
    return { score: r.score, feedback: r.feedback, analysis: { frames: 1, coverage: hip.length ? 1 : 0, movement, metrics: r.metrics, notes: r.notes } };
  } else {
    for (let i = 0; i < N; i++) {
      let t = (dur * i) / denom;
      t = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
      if (!Number.isFinite(t)) t = 0;

      await new Promise<void>(res => {
        const onSeek = () => { v.removeEventListener("seeked", onSeek); res(); };
        v.addEventListener("seeked", onSeek, { once: true });
        try { v.currentTime = t; } catch { res(); }
      });

      const poses = await det.estimatePoses(v, { maxPoses: 1 });
      const p = poses[0]?.keypoints; if (!p) continue;
      const ls = kp(p, "left_shoulder", 5), rs = kp(p, "right_shoulder", 6);
      const lh = kp(p, "left_hip", 11), rh = kp(p, "right_hip", 12);
      const lk = kp(p, "left_knee", 13), rk = kp(p, "right_knee", 14);
      const la = kp(p, "left_ankle", 15), ra = kp(p, "right_ankle", 16);
      if (!(ls && rs && lh && rh && lk && rk && la && ra)) continue;

      const midS = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
      const midH = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
      const midA = { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2 };
      spine.push(Math.abs(90 - Math.abs(lineAngle(midH as any, midS as any))));
      hip.push(ang(midS as any, midH as any, midA as any));
      kL.push(ang(lh as any, lk as any, la as any));
      kR.push(ang(rh as any, rk as any, ra as any));
    }

    const coverage = hip.length ? Math.min(1, hip.length / N) : 0;
    const r = scoreFromMetrics(movement, hip, kL, kR, spine, coverage);
    return { score: r.score, feedback: r.feedback, analysis: { frames: N, coverage: +coverage.toFixed(2), movement, metrics: r.metrics, notes: r.notes } };
  }
}


function isImageMime(m?:string){ return !!m && m.startsWith("image/"); }
function isVideoMime(m?:string){ return !!m && m.startsWith("video/"); }
function ext(url:string){ return url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || ""; }

export async function analyzeMedia(preview: Preview, movement:string){
  const mime = preview.mime;
  if (isImageMime(mime)) return analyzeImage(preview.url, movement);
  if (isVideoMime(mime)) return analyzeVideo(preview.url, movement);
  const e = ext(preview.url);
  if (["png","jpg","jpeg","webp"].includes(e)) return analyzeImage(preview.url, movement);
  return analyzeVideo(preview.url, movement);
}

export async function warmUpPose(){ await getDetector(); }
export type MediaPreview = { url: string; mime?: string };

export async function startLiveOverlay(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const det = await getDetector();
  const ctx = canvas.getContext("2d")!;
  const pairs: [number, number][] = [
    [5,7],[7,9],[6,8],[8,10],[11,13],[13,15],[12,14],[14,16],[5,6],[11,12],[5,11],[6,12]
  ];
  let raf = 0, running = true;

  const draw = (kps: posed.Keypoint[]) => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.lineWidth = 2; ctx.strokeStyle = "#00c2ff"; ctx.fillStyle = "#00c2ff";
    const s = 0.3;
    for (const k of kps) {
      const sc = (k as any).score ?? 1;
      if (sc > s) { ctx.beginPath(); ctx.arc(k.x, k.y, 3, 0, Math.PI*2); ctx.fill(); }
    }
    ctx.beginPath();
    for (const [a,b] of pairs) {
      const ka = kps[a], kb = kps[b];
      const sa = (ka as any)?.score ?? 1, sb = (kb as any)?.score ?? 1;
      if (ka && kb && sa > s && sb > s) { ctx.moveTo(ka.x, ka.y); ctx.lineTo(kb.x, kb.y); }
    }
    ctx.stroke();
  };

  const loop = async () => {
    if (!running) return;

    // guard: skip frames until video has real dimensions
    const w = video.videoWidth | 0;
    const h = video.videoHeight | 0;
    if (!w || !h) {
      raf = requestAnimationFrame(loop);
      return;
    }

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    try {
      const poses = await det.estimatePoses(video, { maxPoses: 1 });
      if (poses[0]?.keypoints) draw(poses[0].keypoints);
    } catch {
      // swallow transient 0x0/reshape errors and retry next frame
    }

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    ctx.clearRect(0,0,canvas.width,canvas.height);
  };
}

