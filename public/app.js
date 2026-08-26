const $ = (selector) =>
  document.querySelector(selector);

const mainButton =
  $("#mainButton");

const endButton =
  $("#endButton");

const orb =
  $("#orb");

const stateText =
  $("#stateText");

const subText =
  $("#subText");

const connection =
  $("#connection");

const lastEvent =
  $("#lastEvent");

const statusDot =
  $("#statusDot");

const remoteAudio =
  $("#remoteAudio");


let peerConnection = null;
let dataChannel = null;
let microphoneStream = null;
let isConnected = false;


function setState(
  type,
  title,
  subtitle = ""
) {
  orb.className =
    "orb " + type;

  stateText.textContent =
    title;

  subText.textContent =
    subtitle;
}


function setConnection(text) {
  connection.textContent =
    text;
}


function showEvent(text) {
  lastEvent.textContent =
    text;
}


async function startConversation() {

  if (isConnected) {
    return;
  }

  mainButton.disabled =
    true;

  setState(
    "connecting",
    "接続しています…",
    "最初だけマイクを許可してください"
  );

  setConnection(
    "接続中"
  );

  try {

    /*
      iPhone / iPad のマイク取得
    */

    microphoneStream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });


    /*
      WebRTC 接続作成
    */

    peerConnection =
      new RTCPeerConnection();


    /*
      OpenAIから返ってくる音声
    */

    peerConnection.ontrack =
      (event) => {

        const stream =
          event.streams[0];

        remoteAudio.srcObject =
          stream;

        remoteAudio
          .play()
          .catch(() => {});

      };


    /*
      自分のマイクを
      OpenAIへストリーム
    */

    microphoneStream
      .getTracks()
      .forEach((track) => {

        peerConnection.addTrack(
          track,
          microphoneStream
        );

      });


    /*
      Realtimeイベント用
      DataChannel
    */

    dataChannel =
      peerConnection
        .createDataChannel(
          "oai-events"
        );


    dataChannel.onopen =
      () => {

        showEvent(
          "Realtime connected"
        );

        /*
          AIから先に
          ホテルスタッフとして
          話しかけてもらう
        */

        dataChannel.send(
          JSON.stringify({
            type:
              "response.create",

            response: {
              instructions:
                "Start the hotel check-in role-play now. Greet the guest naturally and briefly as hotel front-desk staff.",
            },
          })
        );

      };


    /*
      Realtimeイベント監視
    */

    dataChannel.onmessage =
      (event) => {

        let message;

        try {
          message =
            JSON.parse(
              event.data
            );
        } catch {
          return;
        }


        showEvent(
          message.type ||
          "Realtime event"
        );


        /*
          ユーザーが話し始めた

          interrupt_response=true
          なのでAI発話中でも
          自動で割り込みます
        */

        if (
          message.type ===
          "input_audio_buffer.speech_started"
        ) {

          setState(
            "listening",
            "聞いています…",
            "そのまま話してください"
          );

        }


        /*
          ユーザーの発話終了
        */

        if (
          message.type ===
          "input_audio_buffer.speech_stopped"
        ) {

          setState(
            "live",
            "考えています…",
            ""
          );

        }


        /*
          AIが返答を始めた
        */

        if (
          message.type ===
          "response.created"
        ) {

          setState(
            "speaking",
            "AIが話しています",
            "途中でもそのまま話しかけてOK"
          );

        }


        /*
          AI返答終了
        */

        if (
          message.type ===
          "response.done"
        ) {

          setState(
            "listening",
            "あなたの番です",
            "普通に話してください"
          );

        }


        /*
          エラー
        */

        if (
          message.type ===
          "error"
        ) {

          console.error(
            message
          );

          const detail =
            message.error?.message ||
            JSON.stringify(
              message.error
            );

          showEvent(
            "ERROR: " +
            detail
          );

        }

      };


    dataChannel.onerror =
      (event) => {

        console.error(
          "DataChannel error",
          event
        );

        showEvent(
          "DataChannel error"
        );

      };


    /*
      接続状態
    */

    peerConnection
      .onconnectionstatechange =
      () => {

        const current =
          peerConnection
            .connectionState;

        setConnection(
          current
        );


        if (
          current ===
          "connected"
        ) {

          isConnected =
            true;

          statusDot
            .classList
            .add("live");

          mainButton
            .classList
            .add("hidden");

          endButton
            .classList
            .remove("hidden");

          setState(
            "listening",
            "会話中",
            "話しっぱなしでOK。AIの途中でも割り込めます"
          );

        }


        if (
          current === "failed" ||
          current === "closed"
        ) {

          cleanup();

        }

      };


    /*
      SDP offer 作成
    */

    const offer =
      await peerConnection
        .createOffer();


    await peerConnection
      .setLocalDescription(
        offer
      );


    /*
      RenderへSDPを送る
    */

    const response =
      await fetch(
        "/api/realtime-call",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/sdp",
          },

          body:
            offer.sdp,
        }
      );


    const answerSDP =
      await response.text();


    if (!response.ok) {

      throw new Error(
        answerSDP
      );

    }


    /*
      OpenAIのSDP answer設定
    */

    await peerConnection
      .setRemoteDescription({
        type: "answer",
        sdp: answerSDP,
      });


  } catch (error) {

    console.error(
      error
    );

    setConnection(
      "エラー"
    );

    setState(
      "idle",
      "接続できませんでした",
      "下のエラー内容を確認してください"
    );

    showEvent(
      error?.message ||
      String(error)
    );

    mainButton.disabled =
      false;

    await cleanupHardware();

  }

}


async function cleanupHardware() {

  try {
    dataChannel?.close();
  } catch {}


  try {
    peerConnection?.close();
  } catch {}


  try {

    microphoneStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

  } catch {}


  dataChannel = null;

  peerConnection = null;

  microphoneStream = null;

  remoteAudio.srcObject =
    null;

  isConnected =
    false;
}


async function cleanup() {

  await cleanupHardware();


  statusDot
    .classList
    .remove("live");


  mainButton
    .classList
    .remove("hidden");


  endButton
    .classList
    .add("hidden");


  mainButton.disabled =
    false;


  setConnection(
    "未接続"
  );


  setState(
    "idle",
    "タップして会話を開始",
    "開始後はトークボタン不要です"
  );

}


mainButton.addEventListener(
  "click",
  startConversation
);


endButton.addEventListener(
  "click",
  cleanup
);


window.addEventListener(
  "pagehide",
  cleanupHardware
);
