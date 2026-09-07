const $ = id => document.getElementById(id);
const video=$("video"), canvas=$("canvas"), resultCanvas=$("resultCanvas");
const ctx=canvas.getContext("2d"), rctx=resultCanvas.getContext("2d");
let stream=null, lastImage=null, lastResult=null, liveTimer=null;

$("startCamera").onclick=async()=>{
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    video.style.display="block"; video.srcObject=stream;
    $("status").textContent="Camera active. Place a square reference beside the part.";
    if($("mode").value==="live") startLive();
  }catch(e){ $("status").textContent="Camera unavailable. Use Upload image instead."; }
};
$("stopCamera").onclick=()=>{ if(liveTimer) clearInterval(liveTimer); if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;} video.style.display="none"; };
$("capture").onclick=()=>captureFrame();
$("upload").onchange=e=>{const f=e.target.files[0];if(f){const im=new Image();im.onload=()=>processImage(im);im.src=URL.createObjectURL(f)}};
$("mode").onchange=()=>{ if($("mode").value==="live" && stream) startLive(); else if(liveTimer) clearInterval(liveTimer); };

function startLive(){
  if(liveTimer) clearInterval(liveTimer);
  liveTimer=setInterval(()=>{if(video.readyState>=2) captureFrame(false)},700);
}
function captureFrame(show=true){
  if(!video.videoWidth) return;
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  ctx.drawImage(video,0,0);
  const im=new Image(); im.onload=()=>processImage(im); im.src=canvas.toDataURL("image/jpeg",.9);
  if(show) $("status").textContent="Frame captured. Running calibration, identification and inspection…";
}
function processImage(im){
  const maxW=1100, scale=Math.min(1,maxW/im.width);
  canvas.width=Math.round(im.width*scale); canvas.height=Math.round(im.height*scale);
  ctx.drawImage(im,0,0,canvas.width,canvas.height);
  lastImage=canvas.toDataURL("image/jpeg",.92);
  resultCanvas.width=canvas.width; resultCanvas.height=canvas.height;
  rctx.drawImage(canvas,0,0);
  $("empty").style.display="none";
  runCV();
}

function runCV(){
  if(typeof cv==="undefined" || !cv.Mat){ setTimeout(runCV,300); return; }
  try{
    const src=cv.imread(canvas);
    const gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(),
          binary=new cv.Mat(), contours=new cv.MatVector(), binContours=new cv.MatVector(),
          hierarchy=new cv.Mat(), binHierarchy=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);

    // Use both edge contours and an intensity-threshold contour pass.
    // Reflective metal parts can have weak Canny edges, while thresholding
    // often preserves their overall silhouette better.
    cv.Canny(blur,edges,45,130);
    cv.findContours(edges,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    cv.threshold(blur,binary,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);
    cv.morphologyEx(binary,binary,cv.MORPH_OPEN,cv.Mat.ones(3,3,cv.CV_8U));
    cv.findContours(binary,binContours,binHierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);

    let candidates=[];
    const addCandidates=(vec)=>{
      for(let i=0;i<vec.size();i++){
        const c=vec.get(i), rect=cv.boundingRect(c), area=cv.contourArea(c);
        // Keep useful component-sized silhouettes while rejecting tiny text/noise.
        if(area>src.rows*src.cols*.001){
          const peri=cv.arcLength(c,true), circ=peri?4*Math.PI*area/(peri*peri):0;
          candidates.push({c,rect,area,circ});
        } else c.delete();
      }
    };
    addCandidates(contours);
    addCandidates(binContours);

    // Remove near-duplicate contours produced by the two CV passes.
    candidates=candidates.filter((a,i,arr)=>!arr.some((b,j)=>j<i &&
      Math.abs(a.rect.x-b.rect.x)<6 && Math.abs(a.rect.y-b.rect.y)<6 &&
      Math.abs(a.rect.width-b.rect.width)<8 && Math.abs(a.rect.height-b.rect.height)<8));
    candidates.sort((a,b)=>b.area-a.area);
    const ref=candidates.find(x=>{
      const r=x.rect, ar=r.width/r.height;
      return ar>.75 && ar<1.33 && x.area>src.rows*src.cols*.025;
    });
    let scaleMmPx=null, refInfo="Not resolved";
    if(ref){
      const known=Number($("referenceSize").value);
      const side=(ref.rect.width+ref.rect.height)/2;
      scaleMmPx=known/side;
      refInfo=`Auto square reference (${known} mm)`;
      rctx.strokeStyle="#22c55e";rctx.lineWidth=3;rctx.strokeRect(ref.rect.x,ref.rect.y,ref.rect.width,ref.rect.height);
      label(`REF ${known} mm`,ref.rect.x,Math.max(18,ref.rect.y-7),"#22c55e");
    }

    const objs=candidates.filter(x=>x!==ref)
      .filter(x=>{
        const r=x.rect, ar=r.width/Math.max(1,r.height);
        // Avoid UI/text-like slivers; retain compact or elongated part silhouettes.
        return Math.max(r.width,r.height)>45 && Math.max(r.width,r.height)<Math.max(src.rows,src.cols)*.9 &&
               !(ar<.06 || ar>16);
      })
      .sort((a,b)=>b.area-a.area).slice(0,12);
    const obj=chooseObject(objs,src.rows,src.cols,ref);
    let mmPerPx=scaleMmPx || null;
    let L= obj ? Math.max(obj.rect.width,obj.rect.height) : 0;
    let W= obj ? Math.min(obj.rect.width,obj.rect.height) : 0;
    let confidence=obj ? obj.score : 0;
    let comp=obj ? obj.type : "Unknown mechanical part";
    let measuredL=mmPerPx?L*mmPerPx:null, measuredW=mmPerPx?W*mmPerPx:null;
    let uncertainty=mmPerPx?2*mmPerPx:null;

    if(obj){
      rctx.strokeStyle="#60a5fa";rctx.lineWidth=3;rctx.strokeRect(obj.rect.x,obj.rect.y,obj.rect.width,obj.rect.height);
      label(`${comp} ${Math.round(confidence*100)}%`,obj.rect.x,Math.min(resultCanvas.height-5,obj.rect.y+obj.rect.height+18),"#60a5fa");
      if(mmPerPx){
        label(`${measuredL.toFixed(1)} × ${measuredW.toFixed(1)} mm`,obj.rect.x,obj.rect.y+16,"#fff");
      }
    }

    const defect=inspectShape(obj);
    const standard=matchStandard(comp,measuredW,measuredL);
    const pass=defect.severity<.45 && (standard.pass!==false);
    updateUI({comp,confidence,refInfo,mmPerPx,measuredL,measuredW,uncertainty,defect,standard,pass});
    lastResult={comp,confidence,refInfo,mmPerPx,measuredL,measuredW,uncertainty,defect,standard,pass};
    src.delete();gray.delete();blur.delete();edges.delete();binary.delete();
    contours.delete();binContours.delete();hierarchy.delete();binHierarchy.delete();
    candidates.forEach(x=>{if(x.c && x!==ref && !objs.includes(x)) x.c.delete()});
  }catch(e){$("status").textContent="CV processing error. Try a clearer image with the reference visible.";console.error(e)}
}

function chooseObject(arr,h,w,ref){
  if(!arr.length)return null;
  let best=null;
  arr.forEach(x=>{
    const r=x.rect, ar=r.width/Math.max(1,r.height);
    const areaRatio=x.area/(h*w);
    let type="Plate / bracket", score=.55;
    if(x.circ>.78 && Math.abs(ar-1)<.35){type="Washer / circular part";score=.82}
    else if(ar>2.5 || ar<.4){type="Shaft / elongated part";score=.74}
    else if(x.circ>.45 && x.circ<.75){type="Bolt / machined part";score=.72}

    // Prefer a substantial physical object over text strokes or annotations.
    if(areaRatio>.006) score+=.12;
    else if(areaRatio<.002) score-=.22;
    if(ref){
      const dx=(r.x+r.width/2)-(ref.rect.x+ref.rect.width/2);
      const dy=(r.y+r.height/2)-(ref.rect.y+ref.rect.height/2);
      const dist=Math.hypot(dx,dy);
      if(dist < Math.max(ref.rect.width,ref.rect.height)*.8) score-=.12;
    }
    if(r.width>0.75*w || r.height>0.85*h) score-=.15;
    score=Math.max(.45,Math.min(.94,score));
    if(!best || score>best.score) best={...x,type,score};
  });
  return best;
}
function inspectShape(obj){
  if(!obj)return {severity:1,text:"Insufficient data: no clear component contour."};
  const ar=obj.rect.width/obj.rect.height;
  let severity=0;
  if(ar<.12 || ar>8) severity=.5;
  if(obj.circ<.12) severity=Math.max(severity,.35);
  return severity<.45
    ? {severity,text:"No obvious gross geometric abnormality detected in the 2D silhouette."}
    : {severity,text:"Irregular silhouette detected; recapture with the part flat and fully visible."};
}
function matchStandard(comp,w,l){
  if(!comp.toLowerCase().includes("bolt")) return {text:"No fastener standard match applied.",pass:true};
  if(!w) return {text:"Fastener class estimated from silhouette; dimensional standard match unavailable.",pass:true};
  const candidates=[{d:6,name:"M6",pitch:"1.0 mm"},{d:8,name:"M8",pitch:"1.25 mm"},{d:10,name:"M10",pitch:"1.5 mm"},{d:12,name:"M12",pitch:"1.75 mm"}];
  let best=candidates.reduce((a,b)=>Math.abs(a.d-w)-Math.abs(b.d-w)<0?a:b);
  const ok=Math.abs(best.d-w)<=1.5;
  return {text:`ISO metric candidate ${best.name}; thread pitch ${best.pitch} (database match, not directly measured).`,pass:ok,name:best.name,pitch:best.pitch};
}
function updateUI(x){
  $("component").textContent=x.comp;
  $("confidence").textContent=`${Math.round(x.confidence*100)}%`;
  $("calibration").textContent=x.refInfo;
  $("scale").textContent=x.mmPerPx?`${x.mmPerPx.toFixed(4)} mm/pixel`:"Not resolved";
  $("length").textContent=x.measuredL?`${x.measuredL.toFixed(1)} mm`:"Insufficient data";
  $("width").textContent=x.measuredW?`${x.measuredW.toFixed(1)} mm`:"Insufficient data";
  $("uncertainty").textContent=x.uncertainty?`±${x.uncertainty.toFixed(2)} mm*`:"Not available";
  $("passfail").textContent=x.pass?"PASS":"FAIL / RECAPTURE";
  $("evidence").innerHTML=`<li>Measured: ${x.measuredL?`${x.measuredL.toFixed(1)} mm overall length, ${x.measuredW.toFixed(1)} mm width/diameter`:"none"}</li><li>AI-estimated: component class and confidence</li><li>Standards matched: ${x.standard.text}</li>`;
  $("notes").textContent=`${x.defect.text} ${x.uncertainty?"*Approximate edge uncertainty assumes ±2 pixels; perspective/lens distortion can add error.":""}`;
  $("status").textContent=`Inspection complete: ${x.pass?"PASS":"FAIL / RECAPTURE"} — ${x.refInfo}.`;
}
function label(text,x,y,bg){
  rctx.font="bold 13px system-ui"; const pad=5, w=rctx.measureText(text).width+pad*2;
  rctx.fillStyle=bg;rctx.fillRect(x,y-15,w,20);rctx.fillStyle="#fff";rctx.fillText(text,x+pad,y);
}
$("pdf").onclick=()=>{
  if(!lastImage||!lastResult){alert("Capture or upload an image first.");return}
  const {jsPDF}=window.jspdf; const doc=new jsPDF();
  doc.setFontSize(18);doc.text("AI Vision Inspection Report",18,20);
  doc.setFontSize(10);doc.text(new Date().toLocaleString(),18,28);
  doc.addImage(lastImage,"JPEG",18,36,95,65);
  const r=lastResult; let y=115;
  const rows=[
    ["Component",r.comp],["AI confidence",`${Math.round(r.confidence*100)}%`],
    ["Calibration",r.refInfo],["Scale",r.mmPerPx?`${r.mmPerPx.toFixed(4)} mm/pixel`:"Not resolved"],
    ["Overall length",r.measuredL?`${r.measuredL.toFixed(1)} mm`:"Insufficient data"],
    ["Width / diameter",r.measuredW?`${r.measuredW.toFixed(1)} mm`:"Insufficient data"],
    ["Uncertainty",r.uncertainty?`±${r.uncertainty.toFixed(2)} mm*`:"Not available"],
    ["Inspection",r.pass?"PASS":"FAIL / RECAPTURE"],
    ["Defect check",r.defect.text],["Standards",r.standard.text]
  ];
  rows.forEach(a=>{doc.setFont("helvetica","bold");doc.text(a[0]+":",18,y);doc.setFont("helvetica","normal");doc.text(String(a[1]),65,y,{maxWidth:125});y+=9});
  doc.setFontSize(9);doc.text("*Uncertainty is an approximate image-edge error model, not aerospace-grade metrology.",18,220,{maxWidth:170});
  doc.text("Measured values use the detected reference scale. AI-estimated values are explicitly labelled.",18,228,{maxWidth:170});
  doc.text("Limitations: perspective, lens distortion, hidden depth, surface roughness and fine thread geometry are not reliably measured from one phone image.",18,236,{maxWidth:170});
  doc.save("inspection-report.pdf");
};
