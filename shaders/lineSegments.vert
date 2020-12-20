attribute vec3 vPos;
attribute vec3 vColor;
attribute vec3 vOffset;
//attribute float vTime;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform vec3 uOffset;
uniform float uInflate;

varying vec3 fColor;
//varying float fTime;

void main(void) {
    vec3 normal = normalize(vPos); // vPos is relative to the center of the model
    gl_Position = uPMatrix * uMVMatrix * vec4(vPos + vOffset + (normal * uInflate * 0.0005), 1.0);
    fColor = vColor;
    //fTime = vTime;
}
