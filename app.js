
const $ = s => document.querySelector(s);
let pc=null, dc=null, localStream=null, connected=false;

const orb=$("#orb"), stateText=$("#stateText"), subText=$("#subText");
const mainButton=$("#mainButton"), endButton=$("#endButton");
const remoteAudio=$("#remoteAudio"), connection=$("#connection");
const lastEvent=$("#lastEvent"), statusDot=$("#statusDot");

function setState(kind,main,sub=""){orb.className="orb "+kind;stateText.textContent=main;subText.textContent=sub}
function logEvent(t){lastEvent.textContent=t}

async function startConversation(){
  if(connected)return;
  mainButton.disabled=true;
  setState("connecting","接続しています…","最初だけマイク許可が必要です");
  connection.textContent="接続中";
  try{
    localStream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });

    pc=new RTCPeerConnection();

    pc.onconnectionstatechange=()=>{
      connection.textContent=pc.connectionState;
      if(pc.connectionState==="connected"){
        connected=true;statusDot.classList.add("live");
        mainButton.classList.add("hidden");endButton.classList.remove("hidden");
        setState("listening","会話中","普通に話してください。AIの途中でも割り込めます");
      }
      if(["failed","closed","disconnected"].includes(pc.connectionState)&&connected) cleanup();
    };

    pc.ontrack=e=>{
      remoteAudio.srcObject=e.streams[0];
      remoteAudio.play().catch(()=>{});
    };

    localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));

    dc=pc.createDataChannel("oai-events");
    dc.onopen=()=>{
      logEvent("Realtime connected");
      dc.send(JSON.stringify({
        type:"response.create",
        response:{instructions:"Begin the hotel check-in role-play now. Greet the guest naturally as hotel front-desk staff. Keep it brief."}
      }));
    };

    dc.onmessage=e=>{
      let evt;try{evt=JSON.parse(e.data)}catch{return}
      logEvent(evt.type||"event");

      if(evt.type==="input_audio_buffer.speech_started"){
        setState("listening","聞いています…","そのまま話してください");
      }
      if(evt.type==="input_audio_buffer.speech_stopped"){
        setState("live","考えています…","");
      }
      if(evt.type==="response.output_audio.delta"||evt.type==="response.audio.delta"||evt.type==="response.output_audio_transcript.delta"){
        setState("speaking","AIが話しています","途中でもそのまま話しかけてOK");
      }
      if(evt.type==="response.done"){
        setState("listening","あなたの番です","普通に話してください");
      }
      if(evt.type==="error"){
        console.error(evt);
        logEvent("ERROR: "+(evt.error?.message||JSON.stringify(evt)));
      }
    };

    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp=await fetch("/api/realtime-call?scene=hotel%20check-in&level=NORMAL",{
      method:"POST",
      headers:{"Content-Type":"application/sdp"},
      body:offer.sdp
    });
    const answerSdp=await resp.text();
    if(!resp.ok)throw new Error(answerSdp);

    await pc.setRemoteDescription({type:"answer",sdp:answerSdp});
  }catch(err){
    console.error(err);
    connection.textContent="エラー";
    setState("idle","接続できませんでした","マイク許可・API設定・Renderログを確認してください");
    logEvent(err.message||String(err));
    mainButton.disabled=false;
    await hardCleanup();
  }
}

async function hardCleanup(){
  try{dc?.close()}catch{}
  try{pc?.close()}catch{}
  try{localStream?.getTracks().forEach(t=>t.stop())}catch{}
  pc=null;dc=null;localStream=null;connected=false;remoteAudio.srcObject=null;
}
async function cleanup(){
  await hardCleanup();
  statusDot.classList.remove("live");
  mainButton.classList.remove("hidden");endButton.classList.add("hidden");
  mainButton.disabled=false;connection.textContent="未接続";
  setState("idle","タップして会話を開始","開始後はトークボタン不要です");
}
mainButton.addEventListener("click",startConversation);
endButton.addEventListener("click",cleanup);
window.addEventListener("pagehide",hardCleanup);
