/**
 * A class for storing an audio buffer and audio features
 */
class AudioObj {
    /**
     * @param {DOM Element} audioWidgetDOM DOM element for audio controls
     * @param {ProgressBar} progressBar Progress bar object (shared with canvas)
     */
    constructor(audioWidgetDOM, progressBar) {
        this.audioWidget = audioWidgetDOM;
        this.progressBar = progressBar;
        this.justLoaded = false;
        this.times = [0];
        this.colors = [];
        this.features = {};
    }

    updateParams(params) {
        this.audioWidget.src = params.audio;
        this.times = params.times;
        this.colors = params.colors;
        this.features = params.features;
    }
    
    /**
     * Compute a 3D projection of the selected audio features using a specified
     * normalization followed by PCA
     * @param {object} featureWeights An object whose fields are feature names
     *                                and whose values are weights between 0 
     *                                and 1 for those features
     * @param {function} featureNorm A function to normalize the point cloud
     *                              for each feature
     * @param {function} jointNorm A function to normalize the joint embedding
     * @param {int} delayOpts All of the options for performing a sliding window,
     *                      including the window length and booleans for 
     *                      delay embedding and mean/stdev (the latter which are
     *                      mutually exclusive)
     * @return An promise that resolves to an unrolled Float32Array 
     *         of 3D coordinates
     */
    get3DProjection(featureWeights, featureNorm, jointNorm, delayOpts) {
        let audioObj = this;
        this.progressBar.loadColor = "yellow";
        this.progressBar.loading = true;
        this.progressBar.changeLoad();
        return new Promise((resolve) => {
            let worker = new Worker("projworker.js");
            worker.postMessage({featureNorm:featureNorm, jointNorm:jointNorm, featureWeights:featureWeights, features:audioObj.features, delayOpts:delayOpts});
            worker.onmessage = function(event) {
                if (event.data.type == "newTask") {
                    audioObj.progressBar.loadString = event.data.taskString;
                }
                else if (event.data.type == "warning") {
                    console.log("Warning: " + event.data.warning);
                }
                else if (event.data.type == "debug") {
                    console.log("Debug: " + event.data.debug);
                }
                else if (event.data.type == "end") {
                    audioObj.progressBar.changeToReady();
                    audioObj.justLoaded = true;
                    audioObj.audioWidget.pause();
                    resolve(flatten32(event.data.X));
                }
            }
        });
    }

    /**
     * An unrolled Float32Array of times 
     */
    getTimesArray() {
        return flatten32(this.times);
    }

    /**
     * An unrolled Float32Array of colors 
     */
    getColorsArray() {
        return flatten32(this.colors);
    }

    /**
     * Return the index of the row with the closest time to
     * the currently playing time in the audio widget, or
     * return the last index if the audio was just loaded so
     * that the whole curve is displayed
     */
    getClosestIdx() {
        if (!this.audioWidget.paused) {
            this.justLoaded = false;
        }
        if (this.justLoaded) {
            return this.times.length;
        }
        //TODO: Make a binary search
        let time = this.audioWidget.currentTime;
        let t = 0;
		let mindiff = Math.abs(time - this.times[0]);
		for (let i = 1; i < this.times.length; i++) {
		    let diff = Math.abs(this.times[i] - time);
		    if (diff < mindiff) {
		        mindiff = diff;
		        t = i;
		    }
		}
		return t;
    }
}
