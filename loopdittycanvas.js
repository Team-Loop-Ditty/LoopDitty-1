
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
        this.vertexVBO = -1;
        this.normalVBO = -1;
        this.lineVBO = -1;
        this.lineColorVBO = -1;
        this.pointColorVBO = -1;
        this.icosMesh = [];
        let canvas = this;
        this.shader = getShaderProgramAsync(canvas.gl, "shaders/lineSegments");
        this.shader.then(function(shader) {
            let gl = canvas.gl;
            shader.description = 'A shader for drawing lines with a constant color';
            shader.vPosAttrib = gl.getAttribLocation(shader, "vPos");
            gl.enableVertexAttribArray(shader.vPosAttrib);
            shader.vNormalAttrib = gl.getAttribLocation(shader, "vNormal");
            gl.enableVertexAttribArray(shader.vNormalAttrib);
            shader.vColorAttrib = gl.getAttribLocation(shader, "vColor");
            gl.enableVertexAttribArray(shader.vColorAttrib);
            shader.pMatrixUniform = gl.getUniformLocation(shader, "uPMatrix");
            shader.mvMatrixUniform = gl.getUniformLocation(shader, "uMVMatrix");
            shader.inflateUniform = gl.getUniformLocation(shader, "uInflate");
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
                //Initialize vertex buffers
                if (canvas.vertexVBO == -1) {
                    canvas.vertexVBO = canvas.gl.createBuffer();
                }

                if (canvas.icosMesh.length == 0) {
                    canvas.icosMesh = getIcosahedronMesh();
                    for (let v of canvas.icosMesh.vertices) {
                        v.pos = glMatrix.vec3.scale(v.pos, v.pos, 0.0005);
                    }
                }

                let icos = canvas.icosMesh;
                let ind = icos.getTriangleIndices();
                let verts = new Float32Array(X.length * ind.length); // X.length / 3 * ind.length * 3
                for (let i = 0; i < N; ++i) {
                    for (let k = 0; k < ind.length; ++k) {
                        let p = icos.vertices[ind[k]].pos;
                        verts[i * ind.length * 3 + k * 3] = p[0] + X[i * 3];
                        verts[i * ind.length * 3 + k * 3 + 1] = p[1] + X[i * 3 + 1];
                        verts[i * ind.length * 3 + k * 3 + 2] = p[2] + X[i * 3 + 2];
                    }
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.vertexVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, verts, canvas.gl.STATIC_DRAW);
                canvas.vertexVBO.itemSize = 3;
                canvas.vertexVBO.numItems = N * ind.length;

                if (canvas.normalVBO == -1) {
                    canvas.normalVBO = canvas.gl.createBuffer();
                }

                let normals = new Float32Array(X.length * ind.length);
                let normList = [];
                for (let i = 0; i < icos.vertices.length; ++i) {
                    normList[i] = icos.vertices[i].getNormal();
                }

                for (let i = 0; i < N; ++i) {
                    for (let k = 0; k < ind.length; ++k) {
                        let n = normList[ind[k]];
                        normals[i * ind.length * 3 + k * 3] = n[0];
                        normals[i * ind.length * 3 + k * 3 + 1] = n[1];
                        normals[i * ind.length * 3 + k * 3 + 2] = n[2];
                    }
                }
                
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.normalVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, normals, canvas.gl.STATIC_DRAW);
                canvas.normalVBO.itemSize = 3;
                canvas.normalVBO.numItems = N * ind.length;

                if (canvas.lineVBO == -1) {
                    canvas.lineVBO = canvas.gl.createBuffer();
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.lineVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, X, canvas.gl.STATIC_DRAW);
                canvas.lineVBO.itemSize = 3;
                canvas.lineVBO.numItems = N;

                //Initialize color buffers
                let colors = canvas.audioObj.getColorsArray();
                if (canvas.lineColorVBO == -1) {
                    canvas.lineColorVBO = canvas.gl.createBuffer();
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.lineColorVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, colors, canvas.gl.STATIC_DRAW);
                canvas.lineColorVBO.itemSize = 3; 
                canvas.lineColorVBO.numItems = N;

                let expand = new Float32Array(verts.length * 3);
                for (let i = 0; i < colors.length / 3; ++i) {
                    for (let k = 0; k < ind.length; ++k) {
                        expand[i * ind.length * 3 + k * 3] = colors[i * 3];
                        expand[i * ind.length * 3 + k * 3 + 1] = colors[i * 3 + 1];
                        expand[i * ind.length * 3 + k * 3 + 2] = colors[i * 3 + 2];
                    }
                }

                if (canvas.pointColorVBO == -1) {
                    canvas.pointColorVBO = canvas.gl.createBuffer();
                }
                canvas.gl.bindBuffer(canvas.gl.ARRAY_BUFFER, canvas.pointColorVBO);
                canvas.gl.bufferData(canvas.gl.ARRAY_BUFFER, expand, canvas.gl.STATIC_DRAW);
                canvas.pointColorVBO.itemSize = 3; 
                canvas.pointColorVBO.numItems = N * ind.length;
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
        else if (this.vertexVBO != -1 && this.normalVBO != -1 && this.lineVBO != -1 && this.pointColorVBO != -1 && this.lineColorVBO != -1 && playIdx > this.delayOpts.winLength - 1) {
            this.gl.useProgram(this.shader);
            this.gl.uniformMatrix4fv(this.shader.pMatrixUniform, false, this.camera.getPMatrix());
            this.gl.uniformMatrix4fv(this.shader.mvMatrixUniform, false, this.camera.getMVMatrix());
            this.gl.uniform1f(this.shader.inflateUniform, this.pointInflateAmount);

            //Step 1: Draw all points unsaturated
            if (!this.disablePoints) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexVBO);
                this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.vertexVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalVBO);
                this.gl.vertexAttribPointer(this.shader.vNormalAttrib, this.normalVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pointColorVBO);
                this.gl.vertexAttribPointer(this.shader.vColorAttrib, this.pointColorVBO.itemSize, this.gl.FLOAT, false, 0, 0);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, (playIdx - this.delayOpts.winLength) * 60 - 60); // 60 = 20 triangles * 3 vertices
            }

            //Draw "time edge" lines between points
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.lineVBO);
            this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.lineVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.lineColorVBO);
            this.gl.vertexAttribPointer(this.shader.vColorAttrib, this.lineColorVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.gl.uniform1f(this.shader.inflateUniform, 0.0);
            // this gave me webgl warnings before by going out of bounds by at least 1 - is this right now?
            this.gl.drawArrays(this.gl.LINES, 0, playIdx - this.delayOpts.winLength);
            this.gl.drawArrays(this.gl.LINES, 1, playIdx - this.delayOpts.winLength);
    
            //Step 2: Draw the current point as a larger point
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexVBO);
            this.gl.vertexAttribPointer(this.shader.vPosAttrib, this.vertexVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalVBO);
            this.gl.vertexAttribPointer(this.shader.vNormalAttrib, this.normalVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pointColorVBO);
            this.gl.vertexAttribPointer(this.shader.vColorAttrib, this.pointColorVBO.itemSize, this.gl.FLOAT, false, 0, 0);
            this.gl.uniform1f(this.shader.inflateUniform, this.pointInflateAmount + 2.5);
            this.gl.drawArrays(this.gl.TRIANGLES, (playIdx - this.delayOpts.winLength) * 60, 60);
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
}
