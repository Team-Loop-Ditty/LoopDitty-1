 // global var to load essentia.js core instance
 let essentiaExtractor;
 let isEssentiaInstance = false;
 // global var for web audio API AudioContext
 let audioCtx;
 // buffer size microphone stream (bufferSize is high in order to make PitchYinProbabilistic algo to work)
 let bufferSize = 2048;
 let hopSize = 1024;
 let melNumBands = 96;

 try {
   const AudioContext = window.AudioContext || window.webkitAudioContext;
   audioCtx = new AudioContext();
 } catch (e) {
   throw "Could not instantiate AudioContext: " + e.message;
 }

 // global var getUserMedia mic stream
 let gumStream;

 // settings for plotting
 let plotContainerId = "plotDiv";
 let plotSpectrogram;

 // record native microphone input and do further audio processing on each audio buffer using the given callback functions
 function startMicRecordStream(
   audioCtx,
   bufferSize,
   onProcessCallback,
   btnCallback
 ) {
   // cross-browser support for getUserMedia
   navigator.getUserMedia =
     navigator.getUserMedia ||
     navigator.webkitGetUserMedia ||
     navigator.mozGetUserMedia ||
     navigator.msGetUserMedia;
   window.URL =
     window.URL || window.webkitURL || window.mozURL || window.msURL;

   if (navigator.getUserMedia) {
     console.log("Initializing audio...");
     navigator.getUserMedia(
       { audio: true, video: false },
       function(stream) {
         gumStream = stream;
         if (gumStream.active) {
           console.log(
             "Audio context sample rate = " + audioCtx.sampleRate
           );
           var mic = audioCtx.createMediaStreamSource(stream);
          
           // In most platforms where the sample rate is 44.1 kHz or 48 kHz,
           // and the default bufferSize will be 4096, giving 10-12 updates/sec.
           console.log("Buffer size = " + bufferSize);
           if (audioCtx.state == "suspended") {
             audioCtx.resume();
           }
           const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
           // onprocess callback (here we can use essentia.js algos)
           scriptNode.onaudioprocess = onProcessCallback;
           // It seems necessary to connect the stream to a sink for the pipeline to work, contrary to documentataions.
           // As a workaround, here we create a gain node with zero gain, and connect temp to the system audio output.
           const gain = audioCtx.createGain();
           gain.gain.setValueAtTime(0, audioCtx.currentTime);
           mic.connect(scriptNode);
           scriptNode.connect(gain);
           gain.connect(audioCtx.destination);

           if (btnCallback) {
             btnCallback();
           }
         } else {
           throw "Mic stream not active";
         }
       },
       function(message) {
         throw "Could not access microphone - " + message;
       }
     );
   } else {
     throw "Could not access microphone - getUserMedia not available";
   }
 }

 function stopMicRecordStream() {
   console.log("Stopped recording ...");
   // stop mic stream
   gumStream.getAudioTracks().forEach(function(track) {
     track.stop();
   });
   $("#recordButton").removeClass("recording");
   $("#recordButton").html(
     'Mic &nbsp;&nbsp;<i class="microphone icon"></i>'
   );
   isPlotting = false;
   audioCtx.suspend();
 }

 // ScriptNodeProcessor callback function to extract pitchyin feature using essentia.js and plotting it on the front-end
 function melSpectrumFeatureExtractor(event) {

    let audioBuffer = event.inputBuffer.getChannelData(0);

    // modifying default extractor settings
    essentiaExtractor.frameSize = bufferSize;
    essentiaExtractor.hopSize = hopSize;
    // settings specific to an algorithm
    essentiaExtractor.profile.MelBands.numberBands = melNumBands;
    // compute hpcp for overlapping frames of audio
    let spectrum = essentiaExtractor.melSpectrumExtractor(audioBuffer, audioCtx.sampleRate);
    let spectrogram = [];
    spectrogram.push(spectrum);
 }

// ScriptNodeProcessor callback function to extract pitchyin feature using essentia.js and plotting it on the front-end
function hpcpFeatureExtractor(event) {

    let audioBuffer = event.inputBuffer.getChannelData(0);

    // modifying default extractor settings
    essentiaExtractor.frameSize = 4096;
    essentiaExtractor.hopSize = hopSize;
    essentiaExtractor.sampleRate = audioCtx.sampleRate;
    // settings specific to an algorithm
    essentiaExtractor.profile.HPCP.nonLinear = true;
    // compute hpcp for overlapping frames of audio
    let hpcp = essentiaExtractor.hpcpExtractor(audioBuffer);
    let hpcpGram = [];
    hpcpGram.push(hpcp);
}