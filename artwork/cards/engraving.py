"""Shared drawing primitives and pigments for the Retruco engraved baraja."""
from math import cos, pi, sin

INK = '#2d2620'
PAPER = '#fffefb'
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
<linearGradient id="gold" x2=".85" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#ffed68"/><stop offset=".4" stop-color="#fbd04b"/><stop offset=".75" stop-color="#f0ae32"/><stop offset="1" stop-color="#f5c84d"/></linearGradient>
<linearGradient id="steel"><stop stop-color="#236582"/><stop offset=".25" stop-color="#7bd1e3"/><stop offset=".47" stop-color="#cdebee"/><stop offset=".52" stop-color="#49a8c6"/><stop offset="1" stop-color="#217599"/></linearGradient>
<linearGradient id="stick"><stop stop-color="#185c37"/><stop offset=".23" stop-color="#2d9c4f"/><stop offset=".48" stop-color="#83bf48"/><stop offset=".72" stop-color="#27964d"/><stop offset="1" stop-color="#1b5e38"/></linearGradient>
<linearGradient id="redwood"><stop stop-color="#a22921"/><stop offset=".35" stop-color="#df4931"/><stop offset=".6" stop-color="#f2663b"/><stop offset="1" stop-color="#b62e25"/></linearGradient>
</defs>"""
