'use strict';
// Traductions des effets en filtres ffmpeg (caméra, filtres, transitions).
const CX = 'iw/2-(iw/zoom/2)', CY = 'ih/2-(ih/zoom/2)';
/* Expressions zoompan : N = nombre total d'images du plan, on = index de l'image de sortie */
const CAMS = {
  push: (N) => ({ z: `1+0.25*on/${N}`, x: CX, y: CY }),
  pull: (N) => ({ z: `1.25-0.25*on/${N}`, x: CX, y: CY }),
  panr: (N) => ({ z: '1.22', x: `(iw-iw/zoom)*on/${N}`, y: CY }),
  panl: (N) => ({ z: '1.22', x: `(iw-iw/zoom)*(1-on/${N})`, y: CY }),
  tiltup: (N) => ({ z: '1.22', x: CX, y: `(ih-ih/zoom)*(1-on/${N})` }),
  tiltdown: (N) => ({ z: '1.22', x: CX, y: `(ih-ih/zoom)*on/${N}` }),
  crane: (N) => ({ z: `1.3-0.25*on/${N}`, x: CX, y: `(ih-ih/zoom)*(1-on/${N})` }),
  drone: (N) => ({ z: `1.45-0.4*on/${N}`, x: CX, y: `(ih-ih/zoom)*(1-on/${N})*0.8` }),
  orbit: (N) => ({ z: '1.3', x: `(iw-iw/zoom)*(0.5-0.5*cos(3.14159*on/${N}))`, y: `ih/2-(ih/zoom/2)+sin(6.28318*on/${N})*(ih-ih/zoom)/6` }),
  whip: (N) => ({ z: '1.3', x: `(iw-iw/zoom)*min(1,on/(${N}*0.2))`, y: CY }),
  dolly: (N) => ({ z: `1+0.5*on/${N}`, x: CX, y: CY }),
  steadi: (N) => ({ z: '1.12', x: `(iw-iw/zoom)*(0.3+0.4*on/${N})`, y: CY }),
  parallax: (N) => ({ z: '1.18', x: `(iw-iw/zoom)*(0.5-0.5*cos(3.14159*on/${N}))`, y: `(ih-ih/zoom)*(0.5+0.25*sin(3.14159*on/${N}))` }),
};
const isShake = (cam) => cam === 'handheld' || cam === 'pov';
const even = (v) => Math.round(v / 2) * 2;

/** Filtre caméra pour une séquence d'images (d=1 : une image de sortie par image d'entrée). */
function camFilter(cam, N, W, H, fps) {
  if (!cam) return '';
  const cover = (k) => `scale=${k * W}:${k * H}:force_original_aspect_ratio=increase,crop=${k * W}:${k * H}`;
  const shake = `crop=${W}:${H}:x='(iw-${W})/2+sin(n/6)*(iw-${W})/2*0.8+sin(n/2.3)*(iw-${W})/2*0.2':y='(ih-${H})/2+cos(n/7)*(ih-${H})/2*0.8'`;
  if (isShake(cam)) {
    const pre = cam === 'pov'
      ? (() => { const c = CAMS.push(N); return `${cover(2)},zoompan=z='${c.z}':x='${c.x}':y='${c.y}':d=1:s=${even(W * 1.12)}x${even(H * 1.12)}:fps=${fps}`; })()
      : `${cover(1)},scale=${even(W * 1.12)}:${even(H * 1.12)}`;
    return `${pre},${shake}`;
  }
  const c = CAMS[cam](N);
  return `${cover(2)},zoompan=z='${c.z}':x='${c.x}':y='${c.y}':d=1:s=${W}x${H}:fps=${fps}`;
}
/** Même mouvement pour une image fixe unique (d = N images générées par zoompan). */
const camSlide = (cam, N) => (CAMS[cam] ? CAMS[cam](N) : null);

const FILTERS = {
  vhs: 'noise=alls=18:allf=t,chromashift=cbh=3:crh=-3,eq=saturation=1.3:contrast=1.1,gblur=sigma=0.6,drawgrid=w=iw:h=3:t=1:c=black@0.22',
  glitch: "rgbashift=rh=-8:bh=8:enable='lt(mod(n,17),3)',noise=alls=10:allf=t",
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  noir: 'hue=s=0,eq=contrast=1.35:brightness=-0.04,vignette=PI/4',
  neon: 'eq=saturation=1.7:contrast=1.15,colorbalance=rs=.12:bs=.2:gm=-.1',
  bleach: 'eq=saturation=0.5:contrast=1.3',
  grain: 'noise=alls=12:allf=t+u,vignette=PI/5',
  pixel: 'scale=trunc(iw/12):trunc(ih/12):flags=neighbor,scale=trunc(iw*12/2)*2:trunc(ih*12/2)*2:flags=neighbor',
  thermal: 'format=gray,pseudocolor=preset=heat',
  holo: 'eq=saturation=1.4,colorchannelmixer=rr=0:rb=0.6:bb=1:gg=0.9,drawgrid=w=iw:h=4:t=1:c=cyan@0.2',
  dream: 'gblur=sigma=2,eq=brightness=0.05:saturation=1.15',
  xray: 'negate,hue=s=0,eq=contrast=1.4',
  tealorange: 'colorbalance=rs=-.12:bs=.18:rh=.18:bh=-.12,eq=contrast=1.08:saturation=1.15',
  golden: 'colorbalance=rs=.1:gs=.04:bs=-.1:rh=.1:bh=-.08,eq=saturation=1.15:brightness=0.02',
  night: 'colorbalance=rs=-.1:bs=.15:rm=-.05:bm=.1,eq=brightness=-0.06:saturation=0.9',
  posterize: 'eq=saturation=1.5:contrast=1.3,lutyuv=y=floor(val/32)*32',
};
/** Déformation à appliquer à l'image précédente pour obtenir la suivante (technique Deforum) : la caméra est « cuite » dans la génération.
 *  gap = nombre d'images vidéo entre la référence et l'image à générer ; k/N = position dans la scène. Retourne null si aucun mouvement. */
function warpStep(cam, N, w, h, k, gap) {
  if (!cam || isShake(cam)) return null;
  const g = gap / N, p = N > 1 ? k / N : 0, PI = Math.PI;
  switch (cam) {
    case 'push': return { z: 1.25 ** g, dx: 0, dy: 0 };
    case 'pull': return { z: 1.25 ** -g, dx: 0, dy: 0 };
    case 'panr': return { z: 1, dx: 0.2 * w * g, dy: 0 };
    case 'panl': return { z: 1, dx: -0.2 * w * g, dy: 0 };
    case 'tiltup': return { z: 1, dx: 0, dy: -0.2 * h * g };
    case 'tiltdown': return { z: 1, dx: 0, dy: 0.2 * h * g };
    case 'crane': return { z: 1.2 ** -g, dx: 0, dy: -0.15 * h * g };
    case 'drone': return { z: 1.3 ** -g, dx: 0, dy: -0.1 * h * g };
    case 'orbit': return { z: 1, dx: 0.3 * w * g * (PI / 2) * Math.sin(PI * p), dy: 0 };
    case 'whip': return { z: 1, dx: p < 0.2 ? 0.3 * w * (gap / (0.2 * N)) : 0, dy: 0 };
    case 'dolly': return { z: 1.5 ** g, dx: 0, dy: 0 };
    case 'steadi': return { z: 1, dx: 0.08 * w * g, dy: 0 };
    case 'parallax': return { z: 1, dx: 0.12 * w * g * (PI / 2) * Math.sin(PI * p), dy: 0 };
    default: return null;
  }
}
const filterVf = (id) => FILTERS[id] || '';
const TRANS = new Set(['fade', 'dissolve', 'fadeblack', 'fadewhite', 'pixelize', 'slideleft', 'zoomin', 'circleopen', 'radial', 'wipeleft', 'hblur', 'hlslice', 'squeezeh', 'smoothleft']);
module.exports = { warpStep, CAMS, camFilter, camSlide, filterVf, FILTERS, TRANS, isShake };
