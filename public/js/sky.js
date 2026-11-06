// The hero: a gold sun sinking into a black sea as you scroll, drawn live on the GPU.
// If WebGL is missing, the CSS gradient behind the canvas stands in.
(() => {
  const canvas = document.getElementById('sky');
  const hero = document.getElementById('hero');
  const night = Number(document.body.dataset.night);
  const span = Number(hero.dataset.span ?? 1);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) {
    canvas.remove();
    return;
  }

  const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAGMENT = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime, uScroll, uHorizon, uSun;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0., a = .5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(11., 7.); a *= .5; }
      return v;
    }
    // Every tone on the hero comes from this one metallic ramp.
    vec3 gold(float v) {
      v = clamp(v, 0., 1.);
      vec3 a = vec3(.043, .035, .024), b = vec3(.30, .185, .055), c = vec3(.78, .58, .21),
           d = vec3(.97, .82, .47), e = vec3(1., .97, .85);
      if (v < .35) return mix(a, b, v / .35);
      if (v < .65) return mix(b, c, (v - .35) / .3);
      if (v < .85) return mix(c, d, (v - .65) / .2);
      return mix(d, e, (v - .85) / .15);
    }
    void main() {
      vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
      float r = uSun;
      float sink = uScroll * uScroll * .5;
      vec2 sun = vec2(0., uHorizon - sink);
      float dusk = 1. - smoothstep(.0, 1., uScroll) * .75;
      float v;

      if (uv.y > uHorizon) {
        vec2 p = uv - sun;
        float d = length(p);
        float angle = atan(p.x, p.y);
        float glow = exp(-max(d - r, 0.) * 5.2);
        // Art deco rays: alternating long and short blades, turning very slowly.
        float fan = pow(.5 + .5 * cos(angle * 40. + uTime * .02), 10.);
        float fanB = pow(.5 + .5 * cos(angle * 40. + 3.1416 + uTime * .02), 10.);
        float rays = fan * exp(-max(d - r, 0.) * 3.6) + fanB * exp(-max(d - r, 0.) * 9.) * .7;
        rays *= smoothstep(r * 1.04, r * 1.16, d);
        v = .012 + glow * .38 * dusk + rays * .17 * dusk;
        v += exp(-(uv.y - uHorizon) * 26.) * .2 * dusk;

        float disc = smoothstep(r, r - .003, d);
        float shade = .86 - .2 * smoothstep(0., r, p.y);
        shade += .045 * sin(p.y * 42. + p.x * 12. + uTime * .3);
        v = mix(v, mix(.6, shade, dusk), disc);

        // Stars come out as the sun goes down.
        vec2 cell = floor(uv * 90.);
        float star = step(.992, hash(cell)) * (.5 + .5 * sin(uTime * 1.3 + hash(cell + 3.) * 40.));
        v += star * .34 * (1. - dusk) * smoothstep(uHorizon + .05, uHorizon + .3, uv.y);
      } else {
        float depth = uHorizon - uv.y;
        float persp = .09 / (depth + .03);
        float slow = uTime * .16;
        float swell = fbm(vec2(uv.x * persp * 4., persp * 1.4 + slow));
        // Broken bars of light on the water, wider toward the viewer.
        float spread = r * (.62 + depth * 1.35);
        float wobble = (fbm(vec2(persp * 3.6 + slow * 1.4, uv.x * .6)) - .5) * .1;
        float column = exp(-pow((uv.x + wobble) / spread, 2.) * 1.5);
        float bars = smoothstep(.4, .62, fbm(vec2(uv.x * 1.6 + wobble * 3., persp * 7.5 + slow * 1.6)));
        float fine = smoothstep(.58, .7, noise(vec2(uv.x * 5., persp * 15. + slow * 2.6)));
        v = .035 + swell * .1 * dusk;
        v += column * (bars * .86 + fine * .28) * dusk * smoothstep(.0, .012, depth + .004);
        v += exp(-depth * 12.) * .23 * dusk * exp(-uv.x * uv.x * 1.6);
        v *= 1. - smoothstep(.12, .46, depth) * .8;
      }
      v *= 1. - .3 * dot(uv, uv);
      v += (hash(gl_FragCoord.xy * .01 + fract(uTime)) - .5) * .014;
      gl_FragColor = vec4(gold(v), 1.);
    }`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
  } catch (error) {
    console.warn(error);
    canvas.remove();
    return;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uScroll = gl.getUniformLocation(program, 'uScroll');
  const uHorizon = gl.getUniformLocation(program, 'uHorizon');
  const uSun = gl.getUniformLocation(program, 'uSun');

  // A second copy of the title in black ink, clipped to the sun. The letters turn dark
  // exactly where they cross the disc, and the edge follows the sun as it sets.
  const stack = document.getElementById('titleStack');
  const ink = stack?.querySelector('h1').cloneNode(true);
  if (ink) {
    ink.removeAttribute('aria-label');
    ink.setAttribute('aria-hidden', 'true');
    ink.classList.add('ink');
    stack.append(ink);
  }
  const geometry = { horizon: -.14, sun: .2 };

  const stillness = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  let frame = 0;

  const resize = () => {
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(hero.clientWidth * scale);
    const h = Math.round(hero.clientHeight * scale);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
    const phone = innerWidth <= 620;
    geometry.horizon = hero.dataset.horizon ? Number(hero.dataset.horizon) : phone ? -.17 : innerWidth <= 1080 ? -.2 : -.14;
    geometry.sun = phone ? .215 : .225 * Math.min(Math.max(hero.clientWidth / hero.clientHeight, .78), 1);
    gl.uniform1f(uHorizon, geometry.horizon);
    gl.uniform1f(uSun, geometry.sun);
  };

  const eclipse = (progress) => {
    if (!ink) return;
    const height = hero.clientHeight;
    const sink = progress * progress * .5;
    const y = height * (.5 - geometry.horizon + sink) - (stack.getBoundingClientRect().top + scrollY);
    ink.style.clipPath = `circle(${geometry.sun * height}px at 50% ${y}px)`;
  };

  const draw = (now) => {
    gl.uniform1f(uTime, now / 1000);
    const progress = Math.min(night + span * (scrollY / Math.max(hero.clientHeight, 1)), 1);
    gl.uniform1f(uScroll, progress);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    eclipse(progress);
  };

  const loop = (now) => {
    frame = 0;
    if (!visible || document.hidden) return;
    draw(now);
    if (!stillness) frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!frame) frame = requestAnimationFrame(loop);
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  }).observe(hero);
  document.addEventListener('visibilitychange', start);
  addEventListener('resize', () => { resize(); start(); });
  if (stillness) addEventListener('scroll', start, { passive: true });

  resize();
  start();
})();
