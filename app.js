const roomInput = document.querySelector('#room-code');
const joinRoomButton = document.querySelector('#join-room');
const startButton = document.querySelector('#start-share');
const stopButton = document.querySelector('#stop-share');
const connectButton = document.querySelector('#connect-viewer');
const disconnectButton = document.querySelector('#disconnect-viewer');
const remoteVideo = document.querySelector('#remote-video');
const emptyStage = document.querySelector('#empty-stage');
const stageCaption = document.querySelector('#stage-caption');
const streamStats = document.querySelector('#stream-stats');
const liveIndicator = document.querySelector('#live-indicator');
const senderStatus = document.querySelector('#sender-status');
const viewerStatus = document.querySelector('#viewer-status');
const pipButton = document.querySelector('#toggle-pip');
const cameraInput = document.querySelector('#share-camera');
const localPreview = document.querySelector('#local-preview');
const systemAudioInput = document.querySelector('#share-system-audio');
const microphoneInput = document.querySelector('#share-microphone');
const cookieBanner = document.querySelector('#cookie-banner');
const acceptCookiesButton = document.querySelector('#accept-cookies');
const cookieLaterButton = document.querySelector('#cookie-later');
const shareDialog = document.querySelector('#share-dialog');
const confirmShareButton = document.querySelector('#confirm-share');
const cancelShareButton = document.querySelector('#cancel-share');

let signalSocket;
let signalQueue = [];
let currentRoom;
let senderPeer;
let viewerPeer;
let localStream;
let remoteStream;
let pendingSenderCandidates = [];
let pendingViewerCandidates = [];
const clientId = crypto.randomUUID();

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return `RELAY-${Array.from(values, value => alphabet[value % alphabet.length]).join('')}`;
}

function setStatus(element, label, active = false) {
  element.classList.toggle('active', active);
  element.lastElementChild.textContent = label;
}

function updateMediaIconStates() {
  cameraInput.closest('.media-toggle').classList.toggle('is-on', cameraInput.checked);
  microphoneInput.closest('.media-toggle').classList.toggle('is-on', microphoneInput.checked);
  cameraInput.closest('.media-toggle').setAttribute('aria-label', cameraInput.checked ? 'Camera on' : 'Camera off');
  microphoneInput.closest('.media-toggle').setAttribute('aria-label', microphoneInput.checked ? 'Microphone on' : 'Microphone muted');
}

function openChannel() {
  signalSocket?.close();
  const room = roomInput.value.trim().toUpperCase() || createRoomCode();
  roomInput.value = room;
  currentRoom = room;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  signalSocket = new WebSocket(`${protocol}//${location.host}`);
  signalSocket.onopen = () => {
    signalSocket.send(JSON.stringify({ type: 'join', room, clientId }));
    for (const message of signalQueue) signalSocket.send(JSON.stringify(message));
    signalQueue = [];
  };
  signalSocket.onmessage = ({ data }) => handleSignal(JSON.parse(data));
  signalSocket.onclose = () => { if (currentRoom === room) setStatus(viewerStatus, 'Offline'); };
}

function sendSignal(data) {
  const message = { ...data, from: clientId };
  if (signalSocket?.readyState === WebSocket.OPEN) signalSocket.send(JSON.stringify(message));
  else signalQueue.push(message);
}

function createPeer(iceHandler, trackHandler) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peer.onicecandidate = ({ candidate }) => candidate && sendSignal({ type: 'candidate', candidate: candidate.toJSON(), role: trackHandler });
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      setStatus(trackHandler === 'sender' ? senderStatus : viewerStatus, 'Connected', true);
    }
    if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
      setStatus(trackHandler === 'sender' ? senderStatus : viewerStatus, 'Waiting');
    }
  };
  peer.ontrack = ({ track }) => {
    if (!remoteStream) remoteStream = new MediaStream();
    if (!remoteStream.getTracks().some(existingTrack => existingTrack.id === track.id)) remoteStream.addTrack(track);
    remoteVideo.srcObject = remoteStream;
    remoteVideo.play().catch(() => {});
    pipButton.disabled = !document.pictureInPictureEnabled;
    emptyStage.hidden = true;
    stageCaption.textContent = 'Your peer is sharing';
    liveIndicator.classList.add('active');
    streamStats.textContent = 'LIVE';
  };
  return peer;
}

async function togglePictureInPicture() {
  if (!document.pictureInPictureEnabled) return;
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }
  if (remoteVideo.srcObject) await remoteVideo.requestPictureInPicture();
}

function updatePictureInPictureLabel() {
  const isFloating = document.pictureInPictureElement === remoteVideo;
  pipButton.lastChild.textContent = isFloating ? ' Exit picture in picture' : ' Picture in picture';
}

async function handleSignal(message) {
  if (message.from === clientId) return;
  if (message.type === 'hello' && message.role === 'viewer' && localStream && !senderPeer) {
    await startSenderPeer();
  }
  if (message.type === 'hello' && message.role === 'sender' && !senderPeer && !disconnectButton.disabled) {
    sendSignal({ type: 'hello', role: 'viewer' });
  }
  if (message.type === 'offer') {
    const peerRole = message.role === 'viewer' ? 'sender' : 'viewer';
    if (peerRole === 'sender' && !senderPeer) senderPeer = createPeer(null, 'sender');
    if (peerRole === 'viewer' && !viewerPeer) viewerPeer = createPeer(null, 'viewer');
    const offerPeer = peerRole === 'sender' ? senderPeer : viewerPeer;
    if (localStream && offerPeer.getSenders().length === 0) {
      localStream.getTracks().forEach(track => offerPeer.addTrack(track, localStream));
    }
    await offerPeer.setRemoteDescription(message.offer);
    const answer = await offerPeer.createAnswer();
    await offerPeer.setLocalDescription(answer);
    sendSignal({ type: 'answer', role: message.role, answer: offerPeer.localDescription.toJSON() });
    setStatus(viewerStatus, 'Connecting', true);
    const pendingCandidates = peerRole === 'sender' ? pendingSenderCandidates : pendingViewerCandidates;
    for (const candidate of pendingCandidates) await offerPeer.addIceCandidate(candidate);
    if (peerRole === 'sender') pendingSenderCandidates = [];
    else pendingViewerCandidates = [];
  }
  if (message.type === 'answer') {
    const answerPeer = message.role === 'viewer' ? viewerPeer : senderPeer;
    if (!answerPeer) return;
    await answerPeer.setRemoteDescription(message.answer);
    const pendingCandidates = message.role === 'viewer' ? pendingViewerCandidates : pendingSenderCandidates;
    for (const candidate of pendingCandidates) await answerPeer.addIceCandidate(candidate);
    if (message.role === 'viewer') pendingViewerCandidates = [];
    else pendingSenderCandidates = [];
  }
  if (message.type === 'candidate') {
    const peer = message.role === 'sender' ? viewerPeer : senderPeer;
    if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate);
    else if (message.role === 'sender') pendingViewerCandidates.push(message.candidate);
    else pendingSenderCandidates.push(message.candidate);
  }
  if (message.type === 'stop') resetRemoteView();
}

async function startSenderPeer() {
  senderPeer = createPeer(null, 'sender');
  localStream.getTracks().forEach(track => senderPeer.addTrack(track, localStream));
  await negotiatePeer(senderPeer, 'sender');
  setStatus(senderStatus, 'Connecting', true);
}

async function negotiatePeer(peer, role) {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendSignal({ type: 'offer', role, offer: peer.localDescription.toJSON() });
}

async function startSharing() {
  let displayStream;
  let cameraStream;
  try {
    if (cameraInput.checked) {
      cameraStream = localStream?.getVideoTracks().length ? localStream : await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      if (microphoneInput.checked && !cameraStream.getAudioTracks().length) {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        microphoneStream.getAudioTracks().forEach(track => cameraStream.addTrack(track));
      }
    } else {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: systemAudioInput.checked });
    }
    const tracks = [...(cameraStream || displayStream).getTracks()];
    if (!cameraInput.checked && microphoneInput.checked) {
      const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tracks.push(...microphoneStream.getAudioTracks());
    }
    localStream = new MediaStream(tracks);
    localPreview.srcObject = localStream;
    localPreview.hidden = !cameraInput.checked;
    if (senderPeer) {
      localStream.getTracks().forEach(track => senderPeer.addTrack(track, localStream));
      await negotiatePeer(senderPeer, 'sender');
    }
    if (viewerPeer) {
      localStream.getTracks().forEach(track => viewerPeer.addTrack(track, localStream));
      await negotiatePeer(viewerPeer, 'viewer');
    }
    localStream.getVideoTracks()[0].addEventListener('ended', () => resetAll(true));
    startButton.disabled = true;
    stopButton.disabled = false;
    setStatus(senderStatus, 'Sharing', true);
    stageCaption.textContent = cameraInput.checked ? 'Your camera is ready to share' : 'Your screen is ready to share';
    sendSignal({ type: 'hello', role: 'sender' });
  } catch (error) {
    displayStream?.getTracks().forEach(track => track.stop());
    cameraStream?.getTracks().forEach(track => track.stop());
    if (cameraInput.checked && !startButton.disabled) {
      localStream?.getTracks().forEach(track => track.stop());
      localStream = null;
      localPreview.srcObject = null;
      localPreview.hidden = true;
    }
    setStatus(senderStatus, error.name === 'NotAllowedError' ? 'Cancelled' : 'Unavailable');
  }
}

function requestScreenShare() {
  if (!shareDialog.open) shareDialog.showModal();
}

function acceptCookies() {
  localStorage.setItem('relay-cookie-consent', 'accepted');
  document.cookie = 'relay_cookie_consent=accepted; max-age=31536000; samesite=lax';
  cookieBanner.hidden = true;
}

function initializeConsent() {
  cookieBanner.hidden = localStorage.getItem('relay-cookie-consent') === 'accepted';
}

function connectViewer() {
  openChannel();
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  setStatus(viewerStatus, 'Connecting', true);
  sendSignal({ type: 'hello', role: 'viewer' });
}

function resetRemoteView() {
  viewerPeer?.close();
  viewerPeer = null;
  remoteVideo.srcObject = null;
  remoteStream = null;
  if (document.pictureInPictureElement === remoteVideo) document.exitPictureInPicture().catch(() => {});
  pipButton.disabled = true;
  updatePictureInPictureLabel();
  emptyStage.hidden = false;
  liveIndicator.classList.remove('active');
  stageCaption.textContent = 'Your peer is not sharing';
  streamStats.textContent = '-- x -- / -- fps';
  setStatus(viewerStatus, 'Listening', true);
}

function resetAll(notify = true) {
  localStream?.getTracks().forEach(track => track.stop());
  senderPeer?.close();
  viewerPeer?.close();
  senderPeer = null;
  viewerPeer = null;
  localStream = null;
  localPreview.srcObject = null;
  localPreview.hidden = true;
  remoteStream = null;
  pendingSenderCandidates = [];
  pendingViewerCandidates = [];
  startButton.disabled = false;
  stopButton.disabled = true;
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  remoteVideo.srcObject = null;
  if (document.pictureInPictureElement === remoteVideo) document.exitPictureInPicture().catch(() => {});
  pipButton.disabled = true;
  updatePictureInPictureLabel();
  emptyStage.hidden = false;
  liveIndicator.classList.remove('active');
  stageCaption.textContent = 'No active stream';
  streamStats.textContent = '-- × -- / -- fps';
  setStatus(senderStatus, 'Ready');
  setStatus(viewerStatus, 'Waiting');
  if (notify) sendSignal({ type: 'stop' });
}

function joinRoom() {
  const room = roomInput.value.trim().toUpperCase() || createRoomCode();
  roomInput.value = room;
  resetAll(false);
  openChannel();
}

roomInput.value = createRoomCode();
roomInput.addEventListener('change', joinRoom);
roomInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') joinRoom();
});
joinRoomButton.addEventListener('click', joinRoom);
startButton.addEventListener('click', requestScreenShare);
confirmShareButton.addEventListener('click', () => { shareDialog.close(); startSharing(); });
cancelShareButton.addEventListener('click', () => shareDialog.close());
acceptCookiesButton.addEventListener('click', acceptCookies);
cookieLaterButton.addEventListener('click', () => { cookieBanner.hidden = true; });
stopButton.addEventListener('click', () => resetAll(true));
connectButton.addEventListener('click', connectViewer);
disconnectButton.addEventListener('click', () => resetAll(true));
pipButton.addEventListener('click', () => togglePictureInPicture().catch(() => {}));
cameraInput.addEventListener('change', () => {
  if (cameraInput.checked) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(stream => {
      if (!cameraInput.checked || startButton.disabled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      localStream = stream;
      localPreview.srcObject = stream;
      localPreview.hidden = false;
      setStatus(senderStatus, 'Camera ready', true);
    }).catch(() => {
      cameraInput.checked = false;
      updateMediaIconStates();
      setStatus(senderStatus, 'Camera unavailable');
    });
  } else if (!startButton.disabled) {
    localStream?.getTracks().forEach(track => track.stop());
    localStream = null;
    localPreview.srcObject = null;
    localPreview.hidden = true;
    setStatus(senderStatus, 'Ready');
  }
});
microphoneInput.addEventListener('change', updateMediaIconStates);
remoteVideo.addEventListener('enterpictureinpicture', updatePictureInPictureLabel);
remoteVideo.addEventListener('leavepictureinpicture', updatePictureInPictureLabel);
initializeConsent();
updateMediaIconStates();
openChannel();