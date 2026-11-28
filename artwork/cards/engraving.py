"""Shared drawing primitives and pigments for the Retruco engraved baraja."""
from math import cos, pi, sin

INK = '#2d2620'
PAPER = '#fff'
GOLD, PALE, OCHRE = '#f6c738', '#fff08a', '#bd841f'
RED, CRIMSON = '#d53024', '#922b21'
BLUE, SKY, NAVY = '#1485af', '#80d3e1', '#185778'
GREEN, LEAF, DARK = '#238544', '#93ab2b', '#245434'
SKIN, BLUSH, WHITE = '#fbdfb0', '#c99270', '#fff9df'


def p(d, fill='none', w=.46, stroke=INK):
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'


def c(x,y,r,fill,stroke=INK,w=.46):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{w}"/>'


def g(cont,t='',name=''):
    transform=f' transform="{t}"' if t else ''
    label=f' aria-label="{name}"' if name else ''
    return f'<g{transform}{label}>{cont}</g>'


def put(cont,x,y,s=1,angle=0,sy=None):
    return g(cont,f'translate({x:.3f} {y:.3f}) rotate({angle:.3f}) scale({s:.4f} {s if sy is None else sy:.4f})')


def line(d,w=.30,col=INK):
    return p(d,'none',w,col)


def flower(x,y,s=1,petals=5,color=GOLD):
    a=''
    for j in range(petals):
        a+=g(p('M0 -.25 C-1.65 -1.5 -1.22 -3.2 -.22 -3.27 C.93 -3.43 1.2 -2 .35 -.2Z',color,.2),f'rotate({j*360/petals})')
    return put(a+c(0,0,.7,PALE,INK,.21),x,y,s)


def palmette():
    return (p('M0 0 C-.4 -2.2 -3 -2.6 -3.6 -4.1 C-4 -5.7 -2 -5.8 -1.9 -4.5 Q-1.8 -3.8 -1.4 -3.9 C-1.7 -6.1 -.6 -7.3 0 -8.2 C.8 -6.7 1.7 -5.6 1.15 -3.8 C3.1 -7 4.4 -5.3 3.9 -4.1 C3 -2.5 .9 -2.3 .4 0Z',GOLD,.22)
            +line('M0 -1 V-5.6 M-2.6 -4.2 L-.8 -2.4 M2.9 -4.3 L.7 -2.2',.18,OCHRE))


def ellipse(x,y,rx,ry,fill,stroke=INK,w=.4):
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke}" stroke-width="{w}"/>'


def ribbon_text(text,x,y,size,color=PALE):
    return f'<text x="{x}" y="{y}" text-anchor="middle" font-family="Georgia,serif" font-size="{size}" font-weight="bold" letter-spacing=".19" fill="{color}">{text}</text>'


DEFS="""<defs>
<radialGradient id="coin-field" cx=".38" cy=".57" r=".72"><stop stop-color="#f0a029"/><stop offset=".42" stop-color="#f8c033"/><stop offset=".78" stop-color="#ffdb44"/><stop offset="1" stop-color="#f3bf29"/></radialGradient>
<linearGradient id="red-enamel" x1="0" y1=".3" x2="1" y2=".55"><stop stop-color="#a62b26"/><stop offset=".21" stop-color="#dc3424"/><stop offset=".48" stop-color="#e6472a"/><stop offset=".73" stop-color="#d72724"/><stop offset="1" stop-color="#ac2826"/></linearGradient>
<linearGradient id="gold" x1="0" y1=".2" x2="1" y2=".63"><stop stop-color="#d29c23"/><stop offset=".15" stop-color="#f4c337"/><stop offset=".38" stop-color="#ffe16b"/><stop offset=".59" stop-color="#f2bf2d"/><stop offset=".80" stop-color="#fbdb54"/><stop offset="1" stop-color="#d7a329"/></linearGradient>
<linearGradient id="steel"><stop stop-color="#236582"/><stop offset=".25" stop-color="#7bd1e3"/><stop offset=".47" stop-color="#cdebee"/><stop offset=".52" stop-color="#49a8c6"/><stop offset="1" stop-color="#217599"/></linearGradient>
<linearGradient id="stick"><stop stop-color="#185c37"/><stop offset=".23" stop-color="#2d9c4f"/><stop offset=".48" stop-color="#83bf48"/><stop offset=".72" stop-color="#27964d"/><stop offset="1" stop-color="#1b5e38"/></linearGradient>
<linearGradient id="redwood"><stop stop-color="#a22921"/><stop offset=".35" stop-color="#df4931"/><stop offset=".6" stop-color="#f2663b"/><stop offset="1" stop-color="#b62e25"/></linearGradient>
</defs>"""


def etch_band(edge, inside, count, color=INK, weight=.19, skip=()):
    """Cut tapered hatch marks across a curved fold or a turned metal surface.

    The four (x, y) points on each side are cubic Bézier controls. The nib
    touches down on the edge and lifts towards the centre of the ornament.
    """
    def point(curve, t):
        u = 1 - t
        weights = (u*u*u, 3*u*u*t, 3*u*t*t, t*t*t)
        return tuple(sum(w * p[k] for w, p in zip(weights, curve)) for k in (0, 1))
    cuts = []
    for i in range(count):
        if i in skip:
            continue
        t = (i + .5) / count
        x, y = point(edge, t)
        inner_x, inner_y = point(inside, t)
        reach = (.86, 1., .74, .94, .9)[i % 5]
        dx, dy = (inner_x - x)*reach, (inner_y - y)*reach
        length = (dx*dx + dy*dy)**.5
        if length == 0:
            continue
        nx, ny = -dy*weight/length, dx*weight/length
        cuts.append(f'M{x:.2f} {y:.2f} q{dx*.48+nx:.2f} {dy*.48+ny:.2f} {dx:.2f} {dy:.2f} '
                    f'q{-dx*.44-nx*2:.2f} {-dy*.44-ny*2:.2f} {-dx:.2f} {-dy:.2f}Z')
    return p(' '.join(cuts),color,0)
