precision mediump float;
varying vec3 fColor;
varying float fTime;
uniform float uTime;

void main(void) {
    //Warm to cold color gradient (default)
    //gl_FragColor = vec4(fColor, 1.0);                //Default
    //gl_FragColor = vec4(fColor*fColor/0.5, 1.0);     //Vibrant
    //gl_FragColor = vec4(fColor*fColor*0.95, 1.0);    //Dim saturated

    //Cold to warm color gradient
    //gl_FragColor = vec4(fColor.zyx, 1.0);                     //Inverse Default
    gl_FragColor = vec4(fColor.zyx*fColor.zyx/0.5, 1.0);      //Inverse Vibrant
    //gl_FragColor = vec4(fColor.zyx*fColor.zyx*0.95, 1.0);     //Inverse Dim Saturated
}
