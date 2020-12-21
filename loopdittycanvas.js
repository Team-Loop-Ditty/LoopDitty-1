
class LoopDittyCanvas extends BaseCanvas {

    /**
     * @param {AudioObj} audioObj The audio object to be associated with this canvas
     * @param {ProgressBar} progressBar Progress bar object
     * @param {DOM Element} fileInput File input button
     * @param {DOM Element} glcanvas Handle to HTML where the glcanvas resides
     * @param {string} shadersrelpath Path to the folder that contains the shaders,
     *                                relative to where the constructor is being called
     */
    constructor(audioObj, progressBar, fileInput, glcanvas) {
        super(glcanvas);
        this.audioObj = audioObj;
        this.progressBar = progressBar;
        this.camera = new MousePolarCamera(glcanvas.width, glcanvas.height);
        this.setupMenubar(fileInput);
        this.setupShaders();
        this.audioObj.audioWidget.addEventListener("play", this.audioEventHandler.bind(this));
        this.audioObj.audioWidget.addEventListener("pause", this.audioEventHandler.bind(this));
        this.audioObj.audioWidget.addEventListener("seek", this.audioEventHandler.bind(this));
        this.instancedArrays = this.gl.getExtension('ANGLE_instanced_arrays');
    }

    audioEventHandler(event) {
        requestAnimationFrame(this.repaint.bind(this));
    }

    /**
     * Setup the GUI elements, including dat.GUI and fileInput handler
     * @param {DOM Element} fileInput File input button
     */
    setupMenubar(fileInput) {
        let canvas = this;
        let gui = new dat.GUI();
        this.gui = gui;
        this.displayOptsFolder = gui.addFolder("Display Options");
        let redrawDisplay = function() {
            requestAnimationFrame(canvas.repaint.bind(canvas));
        };
        this.pointInflateAmount = 0.0;
        this.displayOptsFolder.add(this, "pointInflateAmount", 0.0, 5.0, 0.25).listen().onChange(redrawDisplay);
        this.disablePoints = false;
        this.displayOptsFolder.add(this, "disablePoints").listen().onChange(redrawDisplay);
        let redoGeom = function() {
            canvas.updateGeometry();
        };
        this.lineRes = 6;
        this.displayOptsFolder.add(this, "lineRes", 3, 20, 1).listen().onChange(redoGeom);
        this.lineRadius = 2;
        this.displayOptsFolder.add(this, "lineRadius", 1, 10, 1).listen().onChange(redoGeom);
        this.audioFolder = gui.addFolder("Audio Options");
        this.songName = "Untitled";
        this.audioFolder.add(this, "songName");
        this.audioFolder.add(this, "updateGeometry");
        this.delayOpts = {winLength: 1, mean:true, stdev:true, delayEmbedding:false};
        this.embeddingFolder = this.audioFolder.addFolder("Embedding");
        this.embeddingFolder.add(this.delayOpts, "winLength", 1, 100, 1);
        this.featureNorm = "getSTDevNorm";
        this.jointNorm = "None";
        let normTypes = ["getSTDevNorm", "getZNorm", "None"];
        this.embeddingFolder.add(this, "featureNorm", normTypes);
        this.embeddingFolder.add(this, "jointNorm", normTypes);
        // Ensure that delayEmbedding can be selected only when
        // mean and standard deviation are not
        let toggleDelay = function() {
            if (canvas.delayOpts.mean || canvas.delayOpts.stdev) {
                canvas.delayOpts.delayEmbedding = false;
            }
        }
        this.embeddingFolder.add(this.delayOpts, "mean").listen().onChange(toggleDelay);
        this.embeddingFolder.add(this.delayOpts, "stdev").listen().onChange(toggleDelay);
        this.embeddingFolder.add(this.delayOpts, "delayEmbedding").listen().onChange(function() {
            if (canvas.delayOpts.delayEmbedding) {
                canvas.delayOpts.mean = false;
                canvas.delayOpts.stdev = false;
            }
        });

        this.featureWeightsFolder = this.audioFolder.addFolder("Audio Features");
        this.selectedFeatures = {};

        
        // Setup the handler for file input, assuming there is a DOM
        // element called "fileInput"
        this.fileInput = fileInput;
        fileInput.addEventListener('change', function(e) {
            let file = fileInput.files[0];
            let reader = new FileReader();
            reader.onload = function(e) {
                let params = JSON.parse(reader.result);
                canvas.setupSong(params);
            };
            reader.readAsText(file);
        });

    }

    /**
     * Initialize a promise for the lineSegment shader that will be fulfilled
     * once the asynchronous code load completes and the shader compiles
     */
    setupShaders() {
        this.icosVBO = -1;
        this.pointVBO = -1;
        this.pipeVBO = -1;
        this.timeVBO = -1   // New time VBO
        let canvas = this;
        this.shader = getShaderProgramAsync(canvas.gl, "shaders/lineSegments");
        this.shader.then(function(shader) {
            let gl = canvas.gl;
            shader.description = 'A shader for drawing lines with a constant color';
            shader.vPosAttrib = gl.getAttribLocation(shader, "vPos");
            gl.enableVertexAttribArray(shader.vPosAttrib);
            shader.vTimeAttrib = gl.getAttribLocation(shader, "vTime");     // New time attribute
            gl.enableVertexAttribArray(shader.vTimeAttrib);
            shader.vOffsetAttrib = gl.getAttribLocation(shader, "vOffset");
            gl.disableVertexAttribArray(shader.vOffsetAttrib);
            shader.pMatrixUniform = gl.getUniformLocation(shader, "uPMatrix");
            shader.mvMatrixUniform = gl.getUniformLocation(shader, "uMVMatrix");
            shader.timeUniform = gl.getUniformLocation(shader, "uTime");    // New time uniform
            shader.inflateUniform = gl.getUniformLocation(shader, "uInflate");
            shader.paletteUniform = gl.getUniformLocation(shader, "uPalette");
            shader.paletteSet = false;
            shader.shaderReady = true;
            canvas.shader = shader;
        });
    }

    /**
     * Load a JSON file at a specified path
     * @param {string} path Path to JSON file with audio and features
     */
    loadPrecomputedSong(path) {
        this.progressBar.loadString = "Reading data from server";
        this.progressBar.loadColor = "red";
        this.progressBar.loading = true;
        this.progressBar.ndots = 0;
        progressBar.changeLoad();
        let canvas = this;
        $.get(path, function(params) {
            canvas.setupSong(params);
        });
    }

    /**
     * Determine the bounding box of a curve and use
     * that to update the camera info
     * @param {array} X A flattened array of 3D points
     */
    updateBBox(X) {
        let bbox = [X[0], X[0], X[1], X[1], X[2], X[2]];
        for (let i = 0; i < X.length/3; i++) {
            if (X[i*3] < bbox[0]) {
                bbox[0] = X[i*3];
            }
            if (X[i*3] > bbox[1]) {
                bbox[1] = X[i*3];
            }
            if (X[i*3+1] < bbox[2]) {
                bbox[2] = X[i*3+1];
            }
            if (X[i*3+1] > bbox[3]) {
                bbox[3] = X[i*3+1];
            }
            if (X[i*3+2] < bbox[4]) {
                bbox[4] = X[i*3+2];
            }
            if (X[i*3+2] > bbox[5]) {
                bbox[5] = X[i*3+2];
            }
        }
        this.camera.centerOnBBox(new AABox3D(bbox[0], bbox[1], bbox[2], bbox[3], bbox[4], bbox[5]));
    }

    /**
     * Obtain a 3D projection given the current audio parameters, and
     * update the vertex buffer with the new coordinates
     */
    updateGeometry() {
        let canvas = this;
        if (!('shaderReady' in this.shader)) {
            // Wait for the shader promise to be fulfilled, then try again
            this.shader.then(canvas.updateGeometry.bind(canvas));
        }
        else {
            let XPromise = this.audioObj.get3DProjection(this.selectedFeatures, this.featureNorm, this.jointNorm, this.delayOpts);
            XPromise.then(function(X) {
                let N = X.length/3;
                if (N <= 0) {
                    return;
                }
                canvas.updateBBox(X);

                //Initialize time buffers (new buffer)
                let times = canvas.audioObj.getTimesArray();
                if (canvas.timeVBO == -1) {
                    canvas.timeVBO = canvas.gl.createBuffer();
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.timeVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, times, canvas.gl.STATIC_DRAW);
                canvas.timeVBO.itemSize = 1;
                canvas.timeVBO.numItems = times.length;
                canvas.time = 0.0;
                canvas.thisTime = (new Date()).getTime();
                canvas.lastTime = canvas.thisTime;

                //Initialize vertex buffers
                if (canvas.icosVBO == -1) {
                    canvas.icosVBO = canvas.gl.createBuffer();
                    let icosMesh = getIcosahedronMesh();
                    let ind = icosMesh.getTriangleIndices();
                    let verts = new Float32Array(ind.length * 3);
                    for (let i = 0; i < ind.length; ++i) {
                        let pos = icosMesh.vertices[ind[i]].pos;
                        let v = glMatrix.vec3.scale(glMatrix.vec3.create(), pos, 0.0005);
                        verts[i * 3] = v[0];
                        verts[i * 3 + 1] = v[1];
                        verts[i * 3 + 2] = v[2];
                    }

                    canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.icosVBO);
                    canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, verts, canvas.gl.STATIC_DRAW);
                    canvas.icosVBO.itemSize = 3;
                    canvas.icosVBO.numItems = ind.length;
                }

                if (canvas.pointVBO == -1) {
                    canvas.pointVBO = canvas.gl.createBuffer();
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.pointVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, X, canvas.gl.STATIC_DRAW);
                canvas.pointVBO.itemSize = 3;
                canvas.pointVBO.numItems = N;

                if (canvas.pipeVBO == -1) {
                    canvas.pipeVBO = canvas.gl.createBuffer();
                }

                let radius = canvas.lineRadius * 0.0001;
                let res = canvas.lineRes;
                let stride = res * 2 + 2;
                let verts = new Float32Array(N * stride * 3);
                for (let i = 0; i < X.length - 3; i += 3) {
                    let p1 = glMatrix.vec3.fromValues(X[i], X[i + 1], X[i + 2]);
                    let p2 = glMatrix.vec3.fromValues(X[i + 3], X[i + 4], X[i + 5]);
                    let difference = glMatrix.vec3.subtract(glMatrix.vec3.create(), p2, p1);
                    let dir = glMatrix.vec3.normalize(glMatrix.vec3.create(), difference);
                    // orients circle using Frenet-Serret frames (TBN frames)
                    let normal = glMatrix.vec3.normalize(glMatrix.vec3.create(), glMatrix.vec3.cross(glMatrix.vec3.create(), dir, glMatrix.vec3.add(glMatrix.vec3.create(), p1, p2)));
                    let binormal = glMatrix.vec3.normalize(glMatrix.vec3.create(), glMatrix.vec3.cross(glMatrix.vec3.create(), normal, dir));
                    let component1 = glMatrix.vec3.scale(glMatrix.vec3.create(), binormal, radius);
                    let component2 = glMatrix.vec3.scale(glMatrix.vec3.create(), normal, 0.0);

                    // add first 2 starting verts of triangle strip
                    let vertex = glMatrix.vec3.add(glMatrix.vec3.create(), p1, glMatrix.vec3.add(glMatrix.vec3.create(), component1, component2));
                    verts[i * stride] = vertex[0];
                    verts[i * stride + 1] = vertex[1];
                    verts[i * stride + 2] = vertex[2];
                    vertex = glMatrix.vec3.add(glMatrix.vec3.create(), vertex, difference);
                    verts[i * stride + 3] = vertex[0];
                    verts[i * stride + 4] = vertex[1];
                    verts[i * stride + 5] = vertex[2];

                    // complete triangle strip
                    for (let s = 0; s < res; ++s) {
                        let xComponent = radius * Math.cos((s + 1) % res * 2 * Math.PI / res);
                        let yComponent = radius * Math.sin((s + 1) % res * 2 * Math.PI / res);
                        component1 = glMatrix.vec3.scale(glMatrix.vec3.create(), binormal, xComponent);
                        component2 = glMatrix.vec3.scale(glMatrix.vec3.create(), normal, yComponent);
                        vertex = glMatrix.vec3.add(glMatrix.vec3.create(), p1, glMatrix.vec3.add(glMatrix.vec3.create(), component1, component2));
                        verts[i * stride + s * res + 6] = vertex[0];
                        verts[i * stride + s * res + 7] = vertex[1];
                        verts[i * stride + s * res + 8] = vertex[2];

                        vertex = glMatrix.vec3.add(glMatrix.vec3.create(), vertex, difference);
                        verts[i * stride + s * res + 9] = vertex[0];
                        verts[i * stride + s * res + 10] = vertex[1];
                        verts[i * stride + s * res + 11] = vertex[2];
                    }
                }

                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.pipeVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, verts, canvas.gl.STATIC_DRAW);
                canvas.pipeVBO.itemSize = 3;
                canvas.pipeVBO.numItems = (N - 1) * stride;

                // colors are handled by a static lookup table in the vertex shader

                canvas.progressBar.changeToReady();
                requestAnimationFrame(canvas.repaint.bind(canvas));
            });
        }
    }

    /**
     * Load in a new song
     * @param {object} params Parameters of the song, including song name,
     *                        timing, and features
     */
    setupSong(params) {
        if (!this.gl) {
            alert("Error: GL not properly initialized, so cannot display new song");
            return;
        }
        let canvas = this;
        // Add features to the menu bar as toggles
        this.audioFolder.removeFolder(this.featureWeightsFolder);
        this.featureWeightsFolder = this.audioFolder.addFolder("Features");
        this.selectedFeatures = {};
        for (let feature in params.features) {
            this.selectedFeatures[feature] = 1.0;
            this.featureWeightsFolder.add(this.selectedFeatures, feature, 0, 1);
        }
        this.songName = params.songName;
        //Setup audio buffers
        this.audioObj.updateParams(params);
        this.updateGeometry();
    }

    /**
     * Redraw the curve
     */
    drawScene() {
        this.gl.viewport(0, 0, this.gl.viewportWidth, this.gl.viewportHeight);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        let canvas = this;
        let playIdx = this.audioObj.getClosestIdx();
        if (!('shaderReady' in this.shader)) {
            // Wait until the promise has resolved, then draw again
            this.shader.then(canvas.repaint.bind(canvas));
        }
        else if (playIdx > this.delayOpts.winLength - 1) { // don't need to check VBOs since they should all be set up if shaderReady
            this.gl.useProgram(this.shader);
            this.gl.uniformMatrix4fv(this.shader.pMatrixUniform, false, this.camera.getPMatrix());
            this.gl.uniformMatrix4fv(this.shader.mvMatrixUniform, false, this.camera.getMVMatrix());
            this.gl.uniform1f(this.shader.inflateUniform, this.pointInflateAmount);
            //Setup time uniform for line segment fadeout animation
            this.thisTime = (new Date()).getTime();
            this.time += (this.thisTime - this.lastTime)/1000.0;
            this.lastTime = this.thisTime;

            if (!this.shader.paletteSet) {
                this.shader.paletteSet = true;
                this.gl.uniform3fv(this.shader.paletteUniform, canvas.makePaletteArray());
                this.gl.uniform1f(this.shader.timeUniform, this.audioObj.times[this.audioObj.times.length - 1]);
                this.instancedArrays.vertexAttribDivisorANGLE(this.shader.vOffsetAttrib, 1);
                this.instancedArrays.vertexAttribDivisorANGLE(this.shader.vTimeAttrib, 1);
            }

            //Step 1: Draw all points unsaturated
            if (!this.disablePoints) {
                this.gl.enableVertexAttribArray(this.shader.vOffsetAttrib);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pointVBO);
                this.gl.vertexAttribPointer(this.shader.vOffsetAttrib, this.pointVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.timeVBO);
                this.gl.vertexAttribPointer(this.shader.vTimeAttrib, this.timeVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.icosVBO);
                this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.icosVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.instancedArrays.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, this.icosVBO.numItems, playIdx - this.delayOpts.winLength);
                this.gl.disableVertexAttribArray(this.shader.vOffsetAttrib);
            }

            //Draw "time edge" lines between points
            this.gl.uniform1f(this.shader.inflateUniform, 0.0);
            this.gl.uniform3f(this.shader.offsetUniform, 0, 0, 0);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pipeVBO);
            this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.pipeVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            for (let i = 0; i < playIdx - this.delayOpts.winLength; ++i) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.timeVBO);
                this.gl.vertexAttribPointer(this.shader.vTimeAttrib, this.timeVBO.itemSize, this.gl.FLOAT, false, 0, this.timeVBO.itemSize * i * 4);
                this.instancedArrays.drawArraysInstancedANGLE(this.gl.TRIANGLE_STRIP, i * (this.lineRes * 2 + 2), this.lineRes * 2 + 2, 1);
            }
    
            //Step 2: Draw the current point as a larger point
            this.gl.uniform1f(this.shader.inflateUniform, this.pointInflateAmount + 2.5);
            this.gl.enableVertexAttribArray(this.shader.vOffsetAttrib);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pointVBO);
            this.gl.vertexAttribPointer(this.shader.vOffsetAttrib, this.pointVBO.itemSize, this.gl.FLOAT, false, 0, this.pointVBO.itemSize * (playIdx - this.delayOpts.winLength - 1) * 4);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.timeVBO);
            this.gl.vertexAttribPointer(this.shader.vTimeAttrib, this.timeVBO.itemSize, this.gl.FLOAT, false, 0, this.timeVBO.itemSize * (playIdx - this.delayOpts.winLength - 1) * 4);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.icosVBO);
            this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.icosVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.instancedArrays.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, this.icosVBO.numItems, 1);
            this.gl.disableVertexAttribArray(this.shader.vOffsetAttrib);
        }
    }

    repaint() {
        this.drawScene();
        if (!this.audioObj.audioWidget.paused) {
            // It's getting repainted continuously, so don't
            // react to mouse events, or else the repaint calls
            // will blow up and slow things down
            this.repaintOnInteract = false;
            requestAnimationFrame(this.repaint.bind(this));
        }
        else {
            this.repaintOnInteract = true;
        }
    }

    makePaletteArray() {
        return Float32Array.of(
            0.62, 0.00392, 0.259,
            0.628, 0.0133, 0.261,
            0.637, 0.0227, 0.263,
            0.645, 0.0321, 0.265,
            0.653, 0.0414, 0.267,
            0.662, 0.0508, 0.269,
            0.67, 0.0602, 0.271,
            0.679, 0.0696, 0.273,
            0.687, 0.079, 0.275,
            0.696, 0.0884, 0.277,
            0.704, 0.0977, 0.279,
            0.713, 0.107, 0.281,
            0.721, 0.116, 0.283,
            0.73, 0.126, 0.285,
            0.738, 0.135, 0.287,
            0.746, 0.145, 0.289,
            0.755, 0.154, 0.291,
            0.763, 0.163, 0.293,
            0.772, 0.173, 0.295,
            0.78, 0.182, 0.297,
            0.789, 0.192, 0.299,
            0.797, 0.201, 0.301,
            0.806, 0.21, 0.303,
            0.814, 0.22, 0.305,
            0.823, 0.229, 0.307,
            0.831, 0.238, 0.309,
            0.838, 0.247, 0.309,
            0.842, 0.254, 0.307,
            0.847, 0.261, 0.305,
            0.852, 0.268, 0.303,
            0.857, 0.276, 0.301,
            0.862, 0.283, 0.3,
            0.866, 0.29, 0.298,
            0.871, 0.297, 0.296,
            0.876, 0.305, 0.294,
            0.881, 0.312, 0.292,
            0.885, 0.319, 0.29,
            0.89, 0.326, 0.289,
            0.895, 0.333, 0.287,
            0.9, 0.341, 0.285,
            0.904, 0.348, 0.283,
            0.909, 0.355, 0.281,
            0.914, 0.362, 0.279,
            0.919, 0.37, 0.278,
            0.923, 0.377, 0.276,
            0.928, 0.384, 0.274,
            0.933, 0.391, 0.272,
            0.938, 0.399, 0.27,
            0.943, 0.406, 0.268,
            0.947, 0.413, 0.266,
            0.952, 0.42, 0.265,
            0.957, 0.427, 0.263,
            0.958, 0.437, 0.267,
            0.96, 0.447, 0.272,
            0.961, 0.457, 0.277,
            0.962, 0.467, 0.281,
            0.964, 0.477, 0.286,
            0.965, 0.487, 0.29,
            0.967, 0.497, 0.295,
            0.968, 0.507, 0.3,
            0.969, 0.517, 0.304,
            0.971, 0.527, 0.309,
            0.972, 0.537, 0.313,
            0.973, 0.547, 0.318,
            0.975, 0.557, 0.323,
            0.976, 0.567, 0.327,
            0.978, 0.577, 0.332,
            0.979, 0.587, 0.337,
            0.98, 0.597, 0.341,
            0.982, 0.607, 0.346,
            0.983, 0.617, 0.35,
            0.985, 0.627, 0.355,
            0.986, 0.637, 0.36,
            0.987, 0.647, 0.364,
            0.989, 0.657, 0.369,
            0.99, 0.667, 0.373,
            0.991, 0.677, 0.378,
            0.992, 0.686, 0.384,
            0.992, 0.694, 0.39,
            0.993, 0.702, 0.397,
            0.993, 0.709, 0.403,
            0.993, 0.717, 0.409,
            0.993, 0.725, 0.416,
            0.993, 0.732, 0.422,
            0.993, 0.74, 0.429,
            0.993, 0.748, 0.435,
            0.994, 0.755, 0.442,
            0.994, 0.763, 0.448,
            0.994, 0.771, 0.455,
            0.994, 0.778, 0.461,
            0.994, 0.786, 0.468,
            0.994, 0.794, 0.474,
            0.995, 0.802, 0.481,
            0.995, 0.809, 0.487,
            0.995, 0.817, 0.493,
            0.995, 0.825, 0.5,
            0.995, 0.832, 0.506,
            0.995, 0.84, 0.513,
            0.995, 0.848, 0.519,
            0.996, 0.855, 0.526,
            0.996, 0.863, 0.532,
            0.996, 0.871, 0.539,
            0.996, 0.878, 0.545,
            0.996, 0.883, 0.553,
            0.996, 0.888, 0.561,
            0.997, 0.893, 0.569,
            0.997, 0.898, 0.577,
            0.997, 0.902, 0.585,
            0.997, 0.907, 0.593,
            0.997, 0.912, 0.601,
            0.997, 0.917, 0.609,
            0.997, 0.921, 0.617,
            0.998, 0.926, 0.625,
            0.998, 0.931, 0.633,
            0.998, 0.936, 0.641,
            0.998, 0.94, 0.649,
            0.998, 0.945, 0.657,
            0.998, 0.95, 0.665,
            0.999, 0.955, 0.673,
            0.999, 0.959, 0.681,
            0.999, 0.964, 0.689,
            0.999, 0.969, 0.697,
            0.999, 0.974, 0.705,
            0.999, 0.979, 0.713,
            0.999, 0.983, 0.721,
            1, 0.988, 0.729,
            1, 0.993, 0.737,
            1, 0.998, 0.745,
            0.998, 0.999, 0.746,
            0.994, 0.998, 0.74,
            0.99, 0.996, 0.734,
            0.987, 0.995, 0.728,
            0.983, 0.993, 0.722,
            0.979, 0.992, 0.716,
            0.975, 0.99, 0.71,
            0.971, 0.988, 0.704,
            0.967, 0.987, 0.698,
            0.963, 0.985, 0.692,
            0.96, 0.984, 0.686,
            0.956, 0.982, 0.68,
            0.952, 0.981, 0.674,
            0.948, 0.979, 0.668,
            0.944, 0.978, 0.662,
            0.94, 0.976, 0.656,
            0.937, 0.975, 0.65,
            0.933, 0.973, 0.644,
            0.929, 0.972, 0.638,
            0.925, 0.97, 0.632,
            0.921, 0.968, 0.626,
            0.917, 0.967, 0.62,
            0.913, 0.965, 0.614,
            0.91, 0.964, 0.608,
            0.906, 0.962, 0.602,
            0.902, 0.961, 0.596,
            0.893, 0.957, 0.598,
            0.884, 0.953, 0.6,
            0.875, 0.95, 0.602,
            0.866, 0.946, 0.603,
            0.857, 0.942, 0.605,
            0.848, 0.939, 0.607,
            0.838, 0.935, 0.609,
            0.829, 0.931, 0.611,
            0.82, 0.928, 0.613,
            0.811, 0.924, 0.615,
            0.802, 0.92, 0.616,
            0.793, 0.916, 0.618,
            0.784, 0.913, 0.62,
            0.775, 0.909, 0.622,
            0.766, 0.905, 0.624,
            0.757, 0.902, 0.626,
            0.748, 0.898, 0.627,
            0.739, 0.894, 0.629,
            0.73, 0.891, 0.631,
            0.72, 0.887, 0.633,
            0.711, 0.883, 0.635,
            0.702, 0.88, 0.637,
            0.693, 0.876, 0.639,
            0.684, 0.872, 0.64,
            0.675, 0.869, 0.642,
            0.665, 0.865, 0.643,
            0.655, 0.86, 0.643,
            0.644, 0.856, 0.644,
            0.633, 0.852, 0.644,
            0.623, 0.848, 0.644,
            0.612, 0.844, 0.644,
            0.602, 0.84, 0.644,
            0.591, 0.836, 0.644,
            0.58, 0.831, 0.644,
            0.57, 0.827, 0.645,
            0.559, 0.823, 0.645,
            0.549, 0.819, 0.645,
            0.538, 0.815, 0.645,
            0.527, 0.811, 0.645,
            0.517, 0.806, 0.645,
            0.506, 0.802, 0.646,
            0.496, 0.798, 0.646,
            0.485, 0.794, 0.646,
            0.474, 0.79, 0.646,
            0.464, 0.786, 0.646,
            0.453, 0.782, 0.646,
            0.442, 0.777, 0.646,
            0.432, 0.773, 0.647,
            0.421, 0.769, 0.647,
            0.411, 0.765, 0.647,
            0.4, 0.761, 0.647,
            0.392, 0.752, 0.651,
            0.384, 0.743, 0.654,
            0.376, 0.734, 0.658,
            0.368, 0.725, 0.662,
            0.36, 0.716, 0.666,
            0.352, 0.707, 0.669,
            0.344, 0.698, 0.673,
            0.336, 0.689, 0.677,
            0.328, 0.681, 0.68,
            0.32, 0.672, 0.684,
            0.312, 0.663, 0.688,
            0.304, 0.654, 0.691,
            0.296, 0.645, 0.695,
            0.288, 0.636, 0.699,
            0.28, 0.627, 0.702,
            0.272, 0.618, 0.706,
            0.264, 0.609, 0.71,
            0.256, 0.6, 0.713,
            0.248, 0.591, 0.717,
            0.24, 0.582, 0.721,
            0.232, 0.573, 0.725,
            0.224, 0.565, 0.728,
            0.216, 0.556, 0.732,
            0.208, 0.547, 0.736,
            0.2, 0.538, 0.739,
            0.199, 0.529, 0.739,
            0.206, 0.52, 0.735,
            0.213, 0.511, 0.731,
            0.22, 0.503, 0.727,
            0.227, 0.494, 0.722,
            0.233, 0.485, 0.718,
            0.24, 0.476, 0.714,
            0.247, 0.468, 0.71,
            0.254, 0.459, 0.706,
            0.26, 0.45, 0.702,
            0.267, 0.441, 0.698,
            0.274, 0.433, 0.693,
            0.281, 0.424, 0.689,
            0.287, 0.415, 0.685,
            0.294, 0.406, 0.681,
            0.301, 0.397, 0.677,
            0.308, 0.389, 0.673,
            0.314, 0.38, 0.669,
            0.321, 0.371, 0.664,
            0.328, 0.362, 0.66,
            0.335, 0.354, 0.656,
            0.342, 0.345, 0.652,
            0.348, 0.336, 0.648,
            0.355, 0.327, 0.644,
            0.362, 0.319, 0.639,
            0.369, 0.31, 0.635
        );
    }
}
