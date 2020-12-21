precision mediump float;

attribute vec3 vPos;
attribute vec3 vOffset;
attribute float vTime;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform float uInflate;
uniform float uTime;
uniform vec3 uPalette[256];

varying vec3 fColor;
varying float fTime;

void main(void) {
    vec3 normal = normalize(vPos); // vPos is relative to the center of the model
    gl_Position = uPMatrix * uMVMatrix * vec4(vPos + vOffset + (normal * uInflate * 0.0005), 1.0);
    int timeIndex = int((vTime / uTime) * 255.0);
    fColor = uPalette[timeIndex];
    fTime = vTime;
}
