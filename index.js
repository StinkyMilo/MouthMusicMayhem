import { PitchDetector } from "https://esm.sh/pitchy@4";
import words from "./words.js";
let errorText=document.getElementById("errorText");
let c = document.getElementById("canvas");
let ctx = c.getContext("2d");
let gameUI = document.getElementById("inGameUI");
let menuUI = document.getElementById("menuUI");
let stream;
let numPlayers=1;
let colors = ["black","blue","green","red","purple","orange"];
let turn = 0;
let source;
let mediaRecorder;
let chunks = [];
let audioElement = document.getElementById("audioElement");
let analyzer;
let detector;
let inputBuffer;
const minVolumeDecibels = -35;
let actx;
let history = [];
let numValues = 300;
let loopFrame = 0;
let loopRunning = false;
let loop;
let minFreq = 80;
let maxFreq = 900;
let ctxStarted=false;
let merger;
let destNode;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileReader = new FileReader();
let undoPoints = [];
let currUndoPoint = {
    startFrame: -1,
    addingCircles: false,
    circles: [],
    startAudio: -1,
    endAudio: -1
};
let color = "black";
async function startCtx(){
    actx = new AudioContext();
    if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
        stream = await navigator.mediaDevices.getUserMedia({audio:true})
    }else{
        errorText.innerHTML="Media devices not supported";
        return;
    }
    mediaRecorder = new MediaRecorder(stream);
    source = actx.createMediaStreamSource(stream);
    analyzer = actx.createAnalyser();
    analyzer.fftSize = 2048;
    source.connect(analyzer);
    detector = PitchDetector.forFloat32Array(analyzer.fftSize);
    inputBuffer = new Float32Array(detector.inputLength);
    detector.minVolumeDecibels = minVolumeDecibels;
    ctxStarted=true;
    destNode = actx.createMediaStreamDestination();
}
function freqToY(freq){
    //Old linear version
    return c.height - (freq-minFreq)*(c.height/(maxFreq-minFreq));
    //Attempted exponential version
    // return c.height - (c.height * (Math.log(2)/Math.log(maxFreq-minFreq+1)) * (Math.log(freq - minFreq + 1)/Math.log(2)));
}
function ampToSize(amp){
    return 15*(-Math.exp(-700*amp)+1);
}
let circles = [];
let lastWasAdded = false;
let replaying = false;
let numClaps = 0; //will use this to switch colors on claps
function runLoop(){
    if(loopRunning){
        ctx.clearRect(0,0,c.width,c.height);

        //get the pitch of the most recent ~1/30th-of-a-second snippet of audio
        analyzer.getFloatTimeDomainData(inputBuffer); //saves the recent fourier transform on the recent audio
        let thisPitch = detector.findPitch(inputBuffer,actx.sampleRate); //find the pitch from that transform
        // console.log(inputBuffer);
        let totalVolume = 0;
        for(const amplitude of inputBuffer){
            totalVolume+=amplitude*amplitude;
        }
        totalVolume/=inputBuffer.length;
        // console.log(totalVolume);

        //draw circles...
        // ...at coordinates based on time and frequency
        let penX = (c.width/numValues)*loopFrame;
        let penY = freqToY(thisPitch[0]);
        // console.log(thisPitch[0],penY);
        ctx.fillStyle="black";
        // let color = colors[(turn + numClaps)%numPlayers];

        ctx.fillRect(penX-1,0,2,c.height);
        if(thisPitch[0] >= minFreq && thisPitch[0] <= maxFreq && thisPitch[1] >= 0.9){
            if (!lastWasAdded) {
                currUndoPoint.startFrame = loopFrame;
                currUndoPoint.startAudio = chunks.length - 1;
                currUndoPoint.circles = [];
                currUndoPoint.addingCircles = true;
            }
            const circle = {x:penX,y:penY,r:ampToSize(totalVolume),connect:lastWasAdded,c:color};
            circles.push(circle);
            if (currUndoPoint.addingCircles)
                currUndoPoint.circles.push(circle);
            // console.log(lastWasAdded);
            lastWasAdded=true;
        }else{
            if (lastWasAdded)
                currUndoPoint.endAudio = chunks.length - 1;
                currUndoPoint.addingCircles = false;
            lastWasAdded = false;
        }
        drawCircles();
        // console.log(loopFrame)
        loopFrame++;
        if(loopFrame>=numValues){
            loopRunning=false;
            mediaRecorder.stop();
        }
    }else if(replaying){
        ctx.clearRect(0,0,c.width,c.height);
        let penX = (c.width/numValues)*loopFrame;
        ctx.fillStyle="black";
        ctx.fillRect(penX-1,0,2,c.height);
        drawCircles(penX);
        loopFrame++;
        if(loopFrame>=numValues){
            replaying=false;
        }
    }
}
let recordButton = document.getElementById("recordButton");
window.record = async function(){
    if(loopRunning){
        return;
    }
    recordButton.className = "button primary disabled";
    if(!ctxStarted){
        await startCtx();
    }
    loopRunning = true;
    loopFrame = 0;
    mediaRecorder.start(33);
    mediaRecorder.ondataavailable=(e)=>{
        chunks.push(e.data);
        // console.log(chunks);
    }
    mediaRecorder.onstop=async (e)=>{
        for (let i = undoPoints.length - 1; i >= 0; i--) {
            const undoPoint = undoPoints[i];
            console.log(undoPoint)
            chunks.splice(undoPoint.startAudio, undoPoint.endAudio - undoPoint.startAudio);
        }
        const blob = new Blob(chunks,{type:"audio/ogg; codecs=opus"});
        chunks=[];
        const audioURL = window.URL.createObjectURL(blob);
        audioElement.src=audioURL;
        fileReader.readAsArrayBuffer(blob);
        fileReader.onloadend=()=>{
            const arrayBuffer = fileReader.result;
            actx.decodeAudioData(arrayBuffer,(audioBuffer)=>{
                // console.log(audioBuffer);
                let historySource = actx.createBufferSource();
                historySource.buffer = audioBuffer;
                history.push(historySource);
                historySource.connect(actx.destination);
                turn++;
                recordButton.className = "button primary";
                //Remove all current nodes, effectively removing merger from the hierarchy
                // if(merger){
                //     merger.disconnect();
                // }
                // merger = actx.createChannelMerger(history.length);
                // for(let i = 0; i < history.length; i++){
                //     history[i].connect(merger,0,i);
                // }
                // merger.connect(actx.destination);
            });
        }
    }
}
function setInGame(inGame){
    if(inGame){
        menuUI.style.display = "none";
        gameUI.style.display = "block";
    }else{
        gameUI.style.display = "none";
        menuUI.style.display = "block";
    }
}
setInGame(false);
let playedBefore=false;
let endButton = document.getElementById("endButton");
window.endGame=function(){
    if(playedBefore){
        return;
    }
    replaying=true;
    loopFrame=0;
    for(let i = 0; i < history.length; i++){
        history[i].start();
    }
    playedBefore=true;
    endButton.className = "button disabled";
}
window.startOver=function(){
    history = [];
    circles = [];
    turn=0;
    playedBefore=false;
    endButton.className = "button";
    ctx.clearRect(0,0,c.width,c.height);
}
window.updateRange=function(){
    numPlayers=document.getElementById("numPlayers").value;
    document.getElementById("currentPlayers").innerHTML=numPlayers;
}
const wordP = document.getElementById("word");
window.newWord=async function(){
    let word = words[Math.floor(Math.random()*words.length)].toLowerCase();
    word = word[0].toUpperCase() + word.substring(1);
    wordP.innerHTML = "Guesser, Look Away!"
    await wait(2000);
    wordP.innerHTML = "Showing in 3...";
    await wait(1000);
    wordP.innerHTML = "Showing in 2...";
    await wait(1000);
    wordP.innerHTML = "Showing in 1...";
    await wait(1000);
    wordP.innerHTML=`The word is ${word}.`;
    await wait(1000);
    wordP.innerHTML=`The word is ${word}.<br/>Hiding in 3...`;
    await wait(1000);
    wordP.innerHTML=`The word is ${word}.<br/>Hiding in 2...`;
    await wait(1000);
    wordP.innerHTML=`The word is ${word}.<br/>Hiding in 1...`;
    await wait(1000);
    wordP.innerHTML="";
    setInGame(true);
}

window.wordGuessed = function(){
    startOver();
    setInGame(false);
}
window.giveUp = function(){
    startOver();
    setInGame(false);
}

loop = setInterval(runLoop,33);

window.undo = function() {
    if (currUndoPoint.startFrame == -1 || currUndoPoint.startAudio == -1 || currUndoPoint.endAudio == -1)
        return;
    undoPoints.push(JSON.parse(JSON.stringify(currUndoPoint)));
    for (const circle of currUndoPoint.circles)
        circles.splice(circles.indexOf(circle), 1);
    drawCircles();
    loopFrame = currUndoPoint.startFrame;
    currUndoPoint = {
        startFrame: -1,
        addingCircles: false,
        circles: [],
        startAudio: -1,
        endAudio: -1
    };
};

const drawCircles = function(penX) {
    for (let i = 0; i < circles.length; i++){
        let circ = circles[i];
        if(penX != null && circ.x > penX)
            continue;
        // console.log(`Drawing circle ${circ.x} ${circ.y} ${circ.r} ${circ.connect}`);
        ctx.fillStyle=circles[i].c;
        let connected = i!=0 && circ.connect;
        if(connected){
            let lastCirc = circles[i-1];
            let numFrames = Math.floor(Math.sqrt((circ.x - lastCirc.x)**2 + (circ.y - lastCirc.y)**2));
            for(let j = 0; j < numFrames; j++){
                ctx.beginPath();
                let thisX = lastCirc.x + j*((circ.x-lastCirc.x)/numFrames);
                let thisY = lastCirc.y + j*((circ.y-lastCirc.y)/numFrames);
                let thisR = lastCirc.r + j*((circ.r - lastCirc.r)/numFrames);
                ctx.moveTo(thisX,thisY);
                ctx.arc(thisX,thisY,thisR,0,2*Math.PI);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.beginPath();
        ctx.moveTo(circ.x,circ.y);
        ctx.arc(circ.x,circ.y,circ.r,0,2*Math.PI);
        ctx.closePath();
        ctx.fill();
        // if(!disconnected){
        //     ctx.lineWidth = circ.r;
        //     ctx.moveTo(circles[i-1].x,circles[i-1].y);
        //     ctx.lineTo(circ.x,circ.y);
        //     ctx.closePath();
        //     ctx.stroke();
        // }else{
        //     ctx.moveTo(circ.x,circ.y);
        //     ctx.arc(circ.x,circ.y,circ.r,0,2*Math.PI);
        //     ctx.closePath();
        // }
        // ctx.arc(circ.x,circ.y,circ.r,0,2*Math.PI);
    }
    // ctx.fillStyle="black";
};

window.changeColor = function(c) {
    color = c;
};
