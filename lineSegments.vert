attribute vec3 vPos;
attribute vec3 vNormal;
attribute vec3 vColor;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform float uInflate;

varying vec3 fColor;

void main(void) {
    gl_Position = uPMatrix * uMVMatrix * vec4(vPos + (vNormal * uInflate * 0.0005), 1.0);
    fColor = vColor;
}
