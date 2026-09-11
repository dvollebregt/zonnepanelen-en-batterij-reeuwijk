// ===== Rekenkern zonneplanner v2: per fase, piekbegrenzing, verschuifbaar verbruik =====
const DAYS=[31,28,31,30,31,30,31,31,30,31,30,31];
const MSTART=[0]; for(const d of DAYS) MSTART.push(MSTART[MSTART.length-1]+d*24);
const MONTH=new Uint8Array(8760); for(let m=0;m<12;m++) for(let h=MSTART[m];h<MSTART[m+1];h++) MONTH[h]=m;
const CLOCK=new Uint8Array(8760); for(let h=0;h<8760;h++){const d=(h/24)|0; CLOCK[h]=(h%24+((d>=87&&d<298)?1:0))%24;}
const ONBALANS_10KW=[80,74,95,120,150,178,170,150,130,105,85,80];
const PERIOD=c=>(c>=17&&c<22)?0:(c>=22||c<7)?1:2;
const PENALTY=5; // EUR per kWh boven de fasegrens: harder dan elke prijs

// verschuift een deel van het warmtepomp-/boilerverbruik binnen ±venster uur
function flexShift(D,share,lim,win){
  const N=8760, L=[Float64Array.from(D.ph[0]),Float64Array.from(D.ph[1]),Float64Array.from(D.ph[2])];
  const res={L,moved:0,loss:0};
  if(!(share>0)) return res;
  const LOSS=1.05;
  const flex=[0,1,2].map(p=>{ const f=new Float64Array(N); for(let h=0;h<N;h++) f[h]=share*Math.max(0,L[p][h]-D.bsh[p]*D.base[h]); return f; });
  const move=(p,h,k,x)=>{ L[p][h]-=x; L[p][k]+=x*LOSS; flex[p][h]-=x; res.moved+=x; res.loss+=x*(LOSS-1); };
  // 1. pieken wegschuiven naar uren met ruimte
  for(let h=0;h<N;h++) for(let p=0;p<3;p++){
    if(L[p][h]<=lim) continue;
    let need=Math.min(L[p][h]-lim,flex[p][h]); if(need<=1e-6) continue;
    const cand=[]; for(let k=Math.max(0,h-win);k<=Math.min(N-1,h+win);k++) if(k!==h) cand.push(k);
    cand.sort((a,b)=>Math.abs(a-h)-Math.abs(b-h)||D.price[a]-D.price[b]);
    for(const k of cand){ const room=lim-L[p][k]; if(room<=0) continue; const x=Math.min(need,room/LOSS); move(p,h,k,x); need-=x; if(need<=1e-6) break; }
  }
  // 2. dure uren naar goedkopere uren, zonder nieuwe pieken te maken
  const order=[...Array(N).keys()].sort((a,b)=>D.price[b]-D.price[a]);
  for(const h of order) for(let p=0;p<3;p++){
    let f=flex[p][h]; if(f<=0.01) continue;
    const cand=[]; for(let k=Math.max(0,h-win);k<=Math.min(N-1,h+win);k++) if(k!==h && D.price[k]<D.price[h]-0.03) cand.push(k);
    cand.sort((a,b)=>D.price[a]-D.price[b]);
    for(const k of cand){ const room=lim-L[p][k]; if(room<=0) continue; const x=Math.min(f,room/LOSS); move(p,h,k,x); f-=x; if(f<=0.01) break; }
  }
  return res;
}

function simulate(D,cfg){
  const t=cfg.tariff, N=8760;
  const qf=cfg.qf||1, lim=cfg.phaseLimit, mg=cfg.margin||0.9, limP=lim*mg, limPQ=limP/qf;
  const kWp=cfg.panels*cfg.wp/1000;
  const pv=new Float64Array(N);
  for(let h=0;h<N;h++) pv[h]=kWp*(cfg.orient==='zuid'?D.pv.zuid[h]:0.5*(D.pv.oost[h]+D.pv.west[h]));
  const fx=flexShift(D,cfg.flex||0,limPQ,3), L=fx.L;
  const load=new Float64Array(N); for(let h=0;h<N;h++) load[h]=L[0][h]+L[1][h]+L[2][h];
  const bat=cfg.bat, cap=bat?bat.usable:0, P=bat?bat.power:0, eta=bat?Math.sqrt(bat.eff):1;
  const pcap=bat?P/3:1e9, asym=!!(bat&&cfg.asym);
  const buy=new Float64Array(N), sell=new Float64Array(N);
  for(let h=0;h<N;h++){ buy[h]=(D.price[h]+t.inkoop)*1.21+t.taxBr2; sell[h]=D.price[h]-t.teruglever; }

  // omvormeruitgang A (pv - batterijladen) verdelen over fasen -> netstroom per fase
  const g3=new Float64Array(3);
  function phaseGrid(h,b){
    const A=pv[h]-b, L0=L[0][h], L1=L[1][h], L2=L[2][h];
    if(!asym){ const a=A/3; g3[0]=L0-a; g3[1]=L1-a; g3[2]=L2-a; return; }
    const tot=Math.max(-3*pcap,Math.min(3*pcap,A)), cl=v=>v<-pcap?-pcap:v>pcap?pcap:v;
    let lo=Math.min(L0,L1,L2)-pcap-1, hi=Math.max(L0,L1,L2)+pcap+1;
    for(let i=0;i<28;i++){ const mid=(lo+hi)/2; if(cl(L0-mid)+cl(L1-mid)+cl(L2-mid)>tot) lo=mid; else hi=mid; }
    const lam=(lo+hi)/2; g3[0]=L0-cl(L0-lam); g3[1]=L1-cl(L1-lam); g3[2]=L2-cl(L2-lam);
  }
  const overOf=(LL=lim)=>{ let o=0; for(let p=0;p<3;p++){ const g=g3[p]; if(g*qf>LL) o+=g*qf-LL; else if(-g>LL) o+=-g-LL; } return o; };

  const imp=new Float64Array(N), exp=new Float64Array(N), cur=new Float64Array(N);
  const chPV=new Float64Array(N), chGrid=new Float64Array(N), dis=new Float64Array(N), disGrid=new Float64Array(N), soc=new Float64Array(N);
  const G=[new Float32Array(N),new Float32Array(N),new Float32Array(N)], over=new Float32Array(N);

  function book(h,b){
    const n=load[h]-pv[h], g=n+b;
    if(b>0){ const fromPV=Math.min(b,Math.max(0,-n)); chPV[h]=fromPV; chGrid[h]=b-fromPV; }
    else if(b<0){ const d=-b, toLoad=Math.min(d,Math.max(0,n)); dis[h]=toLoad; disGrid[h]=d-toLoad; }
    if(g>=0) imp[h]=g; else { if(t.curtail&&sell[h]<0) cur[h]=-g; else exp[h]=-g; }
    phaseGrid(h,b); G[0][h]=g3[0]; G[1][h]=g3[1]; G[2][h]=g3[2]; over[h]=overOf();
  }
  // extra ontladen om fasen onder de grens te houden (piekbegrenzing)
  function shave(h,b,s){
    phaseGrid(h,b); if(overOf(limP)<=1e-6) return b;
    let need=0;
    if(asym){ for(let p=0;p<3;p++) need+=Math.max(0,g3[p]-limPQ); }
    else { let r=0; for(let p=0;p<3;p++) r=Math.max(r,g3[p]-limPQ); need=3*Math.max(0,r); }
    const room=Math.max(0,Math.min(P+b, s*eta+Math.max(0,b)));
    return b-Math.min(need,room);
  }

  if(!bat||cfg.strategy==='geen'){
    for(let h=0;h<N;h++) book(h,0);
  } else if(cfg.strategy==='zelf'||cfg.strategy==='piek'){
    let s=0;
    for(let h=0;h<N;h++){
      const n=load[h]-pv[h]; let b=0;
      if(n<0){ const c=Math.min(-n,P,(cap-s)/eta); b=c; }
      else if(cfg.strategy==='zelf'||PERIOD(CLOCK[h])===0){ b=-Math.min(n,P,s*eta); }
      b=shave(h,b,s);
      if(b>=0) s+=b*eta; else s+=b/eta;
      s=Math.max(0,Math.min(cap,s)); soc[h]=s; book(h,b);
    }
  } else {
    const S=21, step=cap/(S-1), H=36, DEG=0.02;
    const upMax=Math.max(0,Math.floor(P*eta/step+1e-9)), dnMax=Math.max(0,Math.floor(P/(eta*step)+1e-9)), K=upMax+dnMax+1;
    const bOf=new Float64Array(K); for(let q=0;q<K;q++){ const dl=q-dnMax; bOf[q]=dl>=0?dl*step/eta:dl*step*eta; }
    const C=new Float64Array(N*K);
    for(let h=0;h<N;h++){
      const n=load[h]-pv[h];
      for(let q=0;q<K;q++){
        const b=bOf[q], g=n+b; let c;
        if(g>=0) c=g*buy[h]; else c=(t.curtail&&sell[h]<0)?0:g*sell[h];
        const a=(pv[h]-b)/3; let os=0; for(let p=0;p<3;p++){ const gg=L[p][h]-a; if(gg*qf>limP) os+=gg*qf-limP; else if(-gg>limP) os+=-gg-limP; }
        if(os>0&&asym){ phaseGrid(h,b); os=overOf(limP); }
        c+=os*PENALTY;
        if(q<dnMax) c+=(dnMax-q)*step*DEG;
        C[h*K+q]=c;
      }
    }
    const V=new Float64Array((H+1)*S); let lvl=0;
    for(let d=0;d<365;d++){
      const h0=d*24, hz=Math.min(H,N-h0);
      let vT=1e9; for(let k=Math.max(0,hz-12);k<hz;k++) vT=Math.min(vT,buy[h0+k]); vT*=eta*0.9;
      for(let s=0;s<S;s++) V[hz*S+s]=-s*step*vT;
      for(let k=hz-1;k>=0;k--){
        const base=(h0+k)*K;
        for(let i=0;i<S;i++){
          let best=1e18; const lo=Math.max(0,i-dnMax), hi=Math.min(S-1,i+upMax);
          for(let j=lo;j<=hi;j++){ const v=C[base+j-i+dnMax]+V[(k+1)*S+j]; if(v<best) best=v; }
          V[k*S+i]=best;
        }
      }
      for(let k=0;k<Math.min(24,hz);k++){
        const h=h0+k, base=h*K; let best=1e18, bj=lvl; const lo=Math.max(0,lvl-dnMax), hi=Math.min(S-1,lvl+upMax);
        for(let j=lo;j<=hi;j++){ const v=C[base+j-lvl+dnMax]+V[(k+1)*S+j]; if(v<best-1e-12){best=v;bj=j;} }
        const b=bOf[bj-lvl+dnMax]; lvl=bj; soc[h]=lvl*step; book(h,b);
      }
    }
  }

  const M=[...Array(12)].map(()=>({pv:0,load:0,imp:0,exp:0,cur:0,direct:0,chPV:0,chGrid:0,piek:0,nacht:0,dag:0,naarNet:0,energie:0,teruglever:0,belasting:0,vast:0,onbalans:0,kosten:0,peakKW:0,peakPh:[0,0,0],overUren:0,overKWh:0}));
  let I=0;
  for(let h=0;h<N;h++){
    const m=M[MONTH[h]];
    m.pv+=pv[h]; m.load+=load[h]; m.imp+=imp[h]; m.exp+=exp[h]; m.cur+=cur[h];
    m.direct+=Math.min(pv[h],load[h]); m.chPV+=chPV[h]; m.chGrid+=chGrid[h]; m.naarNet+=disGrid[h];
    const pe=PERIOD(CLOCK[h]); if(pe===0)m.piek+=dis[h]; else if(pe===1)m.nacht+=dis[h]; else m.dag+=dis[h];
    m.energie+=imp[h]*(D.price[h]+t.inkoop)*1.21; m.teruglever+=exp[h]*sell[h];
    if(imp[h]>m.peakKW) m.peakKW=imp[h];
    for(let p=0;p<3;p++){ const v=G[p][h]*qf; if(v>m.peakPh[p]) m.peakPh[p]=v; }
    if(over[h]>1e-6){ m.overUren++; m.overKWh+=over[h]; }
    I+=imp[h];
  }
  const taxTot=Math.min(I,10000)*t.taxBr1+Math.max(0,Math.min(I,50000)-10000)*t.taxBr2;
  for(let mi=0;mi<12;mi++){
    const m=M[mi];
    m.belasting=(I>0?taxTot*m.imp/I:0)-t.vermindering/12;
    m.vast=(cfg.netbeheer+t.vastrechtMaand*12)/12;
    if(bat&&cfg.onbalans){ const dt=m.piek+m.nacht+m.dag+m.naarNet, util=Math.min(1,dt/(cap*DAYS[mi]||1)); m.onbalans=ONBALANS_10KW[mi]*Math.min(P,cap/2)/10*0.8*(1-0.5*util); }
    m.kosten=m.energie-m.teruglever+m.belasting+m.vast-m.onbalans;
  }
  const Y={}; for(const k of Object.keys(M[0])) if(typeof M[0][k]==='number') Y[k]=M.reduce((a,m)=>a+m[k],0);
  Y.peakKW=Math.max(...M.map(m=>m.peakKW)); Y.peakPh=[0,1,2].map(p=>Math.max(...M.map(m=>m.peakPh[p]))); Y.kWp=kWp;
  Y.flexMoved=fx.moved; Y.flexLoss=fx.loss;
  return {months:M,year:Y,soc,pv,load,imp,exp,dis,disGrid,chPV,chGrid,G,over};
}
if(typeof module!=='undefined') module.exports={simulate,DAYS,MSTART,CLOCK};
