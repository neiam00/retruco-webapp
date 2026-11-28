"""Redraw the 40-card Retruco baraja and its shared back with stock Python."""
from pathlib import Path
from engraving import *
from suits import numbered
from courts import court

ROOT=Path(__file__).resolve().parent
SUITS=('coins','cups','swords','clubs')
RANKS=(1,2,3,4,5,6,7,10,11,12)

# The printer's figures share a 12-unit cap height. Open counters and short
# bracketed serifs keep their shapes when a face is reduced to a few dozen pixels.
# Each entry gives the ink width and the closed outlines, including counters.
FIGURES = {
    '0': (7.4, 'M3.7 0 C6.3 0 7.4 2.5 7.4 6 S6.3 12 3.7 12 0 9.5 0 6 1.1 0 3.7 0Z '
               'M3.7 1.65 C2.7 1.65 2.25 3.1 2.25 6 S2.7 10.35 3.7 10.35 5.15 8.9 5.15 6 4.7 1.65 3.7 1.65Z'),
    '1': (5.8, 'M.35 2.2 L3.63 .15 H4.35 V9.85 Q4.35 10.62 5.8 10.7 V12 H0 V10.7 '
               'Q1.95 10.57 1.95 9.85 V3.38 L.55 3.95Z'),
    '2': (7.35, 'M.1 3.08 Q.76 0 3.93 0 C6.1 0 7.25 1.25 7.25 3.35 C7.25 5.35 6.08 6.77 4.36 8.42 '
                'L2.75 10 H5.36 Q6.05 10 6.18 8.95 H7.35 L7.1 12 H.12 V10.58 L2.95 7.2 '
                'Q4.95 4.85 4.95 3.52 Q4.95 1.77 3.56 1.77 Q2.03 1.77 1.54 3.75Z'),
    '3': (7.4, 'M.12 2.56 Q1.02 0 3.86 0 Q7.1 0 7.1 2.99 Q7.1 4.72 5.35 5.65 '
               'Q7.4 6.41 7.4 8.65 Q7.4 12 3.62 12 Q.7 12 0 9.37 L1.5 8.65 '
               'Q2.22 10.23 3.48 10.23 Q5.05 10.23 5.05 8.55 Q5.05 6.62 2.95 6.62 H2.15 V5.05 H2.96 '
               'Q4.8 5.05 4.8 3.29 Q4.8 1.76 3.49 1.76 Q2.3 1.76 1.55 3.25Z'),
    '4': (8, 'M4.16 .1 H6.72 V7.22 H8 V9 H6.72 V10 Q6.72 10.64 7.61 10.74 V12 H3.22 V10.74 '
             'Q4.47 10.61 4.47 10 V9 H0 V7.23Z M4.47 2.94 L1.98 7.22 H4.47Z'),
    '5': (7.5, 'M.95 .15 H7.03 L6.72 2.2 H2.55 L2.32 4.75 Q3.01 4.45 3.9 4.45 '
               'Q7.5 4.45 7.5 8.04 Q7.5 12 3.65 12 Q.92 12 0 9.47 L1.48 8.64 '
               'Q2.25 10.17 3.51 10.17 Q5.14 10.17 5.14 8.18 Q5.14 6.14 3.26 6.14 Q2.07 6.14 1.45 6.9 L.48 6.52Z'),
    '6': (7.6, 'M6.83 1.23 Q6.17 1.67 5.08 2.23 Q2.98 3.35 2.51 5.33 Q3.41 4.77 4.48 4.77 '
               'Q7.6 4.77 7.6 8.12 Q7.6 12 3.84 12 Q0 12 0 7.54 Q0 2.65 5.83 0Z '
               'M3.9 6.38 Q2.32 6.38 2.32 8.14 Q2.32 10.34 3.86 10.34 Q5.33 10.34 5.33 8.32 Q5.33 6.38 3.9 6.38Z'),
    '7': (7.8, 'M.23 .15 H7.8 V1.55 L5.4 6.42 H6.45 L5.9 7.85 H4.81 L3.23 12 H.74 '
               'L2.55 7.85 H1.51 L2.09 6.42 H3.17 L5.42 2.25 H2.38 Q1.58 2.25 1.37 3.57 H0Z'),
}

# Optical registration of crowded plates within the inner rules. The offsets
# leave room around the small indices, particularly a horse's muzzle or heel.
PLATE_REGISTRATION = {
    'coins': {1: (1, 0, -.35), 10: (1, 2, 2.30), 11: (.935, 1, 0), 12: (.985, -3.3, 3.30)},
    'cups': {10: (.986, -1.15, 3.13), 11: (.955, .85, -1.20), 12: (.95, -3.85, 1)},
    'swords': {4: (.985, 0, -.20), 11: (.89, 2.50, 0), 12: (.945, -2.20, .95)},
    'clubs': {1: (1, -.60, 0), 4: (.97, 0, 0), 6: (.98, 0, 0), 7: (.98, 0, 0),
              10: (.99, 1.25, 2.50), 11: (.935, .75, -1.50), 12: (.98, -2.3, 3.60)},
}


def corner_rank(rank):
    letters = ''
    offset = 0
    for digit in str(rank):
        width, outline = FIGURES[digit]
        letters += f'<path transform="translate({offset:g})" d="{outline}" fill-rule="evenodd"/>'
        offset += width + 1.20
    return g(f'<g fill="#27221e">{letters}</g>', 'translate(11.6 11.4) scale(.55 .56)', name=f'Rank {rank}')


def pintas(suit):
    """Traditional top and bottom suit breaks in the printed inner frame."""
    n=SUITS.index(suit)
    left, right = 9.3, 79.7
    # Each suit divides about one third of the rule into blank spaces,
    # distributed across its one, two or three interruptions.
    gaps = ((), ((32.8, 56.2),), ((25.2, 36.8), (52.2, 63.8)),
            ((20.1, 27.8), (40.65, 48.35), (61.2, 68.9)))[n]
    spans = zip([left] + [end for _, end in gaps], [start for start, _ in gaps] + [right])
    b = line(f'M{left} 9.6 V123.4 M{right} 9.6 V123.4', .60)
    for x0, x1 in spans:
        for y in (9.6, 123.4):
            b += f'<path d="M{x0:g} {y}H{x1:g}" stroke="{INK}" stroke-width=".80" stroke-linecap="butt"/>'
    return g(b,name=f'{n} suit breaks on each horizontal rule')


def back():
    """Two-way, single-ink back: a diaper field between two engraved rosettes."""
    carmine = '#8b3240'
    reserve = '#fff9eb'
    linework = '#eaccc6'
    b = p('M4.45 4.45 H84.55 V128.55 H4.45Z',carmine,0)
    for offset, width in [(5.48,.48),(6.50,.20),(8.0,.57),(8.82,.18)]:
        b+=p(f'M{offset} {offset} H{89-offset} V{133-offset} H{offset}Z','none',width,reserve)
    # A small interlocking lozenge repeat fills the space around the two discs.
    tile=(line('M0 0 Q2.75 0 2.75 2.75 Q2.75 5.50 5.50 5.50 Q8.25 5.50 8.25 2.75 '
               'Q8.25 0 11 0 M0 11 Q2.75 11 2.75 8.25 Q2.75 5.50 5.50 5.50 '
               'Q8.25 5.50 8.25 8.25 Q8.25 11 11 11 M0 5.50 Q0 2.75 2.75 2.75 '
               'Q5.50 2.75 5.50 0 M5.50 11 Q5.50 8.25 8.25 8.25 Q11 8.25 11 5.50',.23,linework)
          +p('M5.5 3.77 L6.24 5.5 L5.5 7.23 L4.76 5.5Z','none',.18,reserve)
          +c(5.5,5.5,.34,reserve,'none',0))
    b+='<defs><pattern id="diaper" x="0.5" y=".5" width="11" height="11" patternUnits="userSpaceOnUse">'+tile+'</pattern></defs>'
    b+=p('M9.25 9.25 H79.75 V123.75 H9.25Z','url(#diaper)',0)
    for angle in (0,180):
        top=''
        # Corner shells and sprays run under the rosette’s outer rings.
        flourish=p('M9.58 9.60 H30.33 Q22.83 10.57 19.32 13.98 Q15.24 15.3 14.01 19.65 '
                   'Q10.58 22.83 9.58 31.55Z',carmine,.32,reserve)
        flourish+=line('M10.79 25.79 Q10.98 18.22 14.90 14.48 Q18.53 10.86 25.40 10.67 '
                      'M11.38 22.11 Q12.24 17.16 15.41 14.96 Q17.23 13.43 20.33 13.18 '
                      'M10.95 11.04 Q15.12 11.04 14.04 12.71 Q13.20 14.06 11.96 13.05 Q11.54 12.34 12.45 12.25 '
                      'M14.61 17.56 Q15.71 15.47 18.31 15.02',.35,reserve)
        top+=flourish+g(flourish,'translate(89 0) scale(-1 1)')
        rosette = ellipse(0,0,23.9,26.45,carmine,reserve,.52)+ellipse(0,0,22.98,25.54,'none',reserve,.22)
        # Lathe-turned engine lines are continuous closed curves; the crest
        # and trough of adjacent turns interlock around the rim.
        for j in range(8):
            points=[]
            for k in range(481):
                t=k*2*pi/480
                r=20.66+1.82*cos(24*t+2*pi*j/8)
                points.append(f'{r*cos(t):.2f} {1.115*r*sin(t):.2f}')
            rosette+=line('M'+' L'.join(points)+'Z',.20,linework if j%2 else reserve)
        rosette+=ellipse(0,0,18.21,20.26,'none',reserve,.40)+ellipse(0,0,17.45,19.42,'none',reserve,.18)
        petal=(line('M0 -1.25 Q-1.47 -7.30 -4.01 -11.12 Q-6.04 -14.56 -3.39 -16.92 '
                    'Q-2.23 -17.98 -.17 -18.42 Q1.77 -18.09 3.60 -16.55 Q6.03 -14.50 4.01 -11.17 '
                    'Q1.48 -7.31 0 -1.25Z M0 -3.30 Q-.87 -8.69 -2.54 -11.98 Q-4.70 -15.68 -.13 -17.20 '
                    'Q4.41 -15.66 2.47 -11.86 Q.71 -8.50 0 -3.30Z M0 -5.06 Q-1.63 -10.93 -1.69 -13.22 '
                    'Q-1.68 -15.16 0 -16 Q1.63 -15.21 1.68 -13.14 Q1.56 -11.09 0 -5.06Z',.24,reserve))
        rosette+='<g transform="scale(1 1.113)">'+''.join(g(petal,f'rotate({i*30})') for i in range(12))+'</g>'
        rosette+=ellipse(0,0,3.65,4.0,carmine,reserve,.35)+ellipse(0,0,2.83,3.14,'none',reserve,.21)
        rosette+=p('M0 -2.03 Q.35 -.35 1.87 0 Q.35 .35 0 2.03 Q-.35 .35 -1.87 0 Q-.35 -.35 0 -2.03Z',reserve,0)
        top+=g(rosette,'translate(44.5 37.0)')
        b+=g(top,f'rotate({angle} 44.5 66.5)')
    b+=p('M35.13 66.5 Q41.78 66.11 44.5 62.67 Q47.22 66.11 53.87 66.5 '
         'Q47.22 66.89 44.5 70.33 Q41.78 66.89 35.13 66.5Z',carmine,.45,reserve)
    b+=p('M40.3 66.5 Q43.36 66.01 44.5 64.62 Q45.64 66.01 48.7 66.5 '
         'Q45.64 66.99 44.5 68.38 Q43.36 66.99 40.3 66.5Z','none',.29,reserve)
    return b


def printed_plate(drawing):
    # A lithographic tint breaks into small flecks on coloured ink. Restrict
    # the grain to the plate silhouette to leave all exposed stock white.
    return ('<defs><g id="plate">' + drawing + '</g>'
            '<mask id="plate-silhouette" maskUnits="userSpaceOnUse" x="0" y="0" width="89" height="133" '
            'style="mask-type:alpha"><use href="#plate"/></mask></defs>'
            '<use href="#plate"/><rect width="89" height="133" fill="url(#ink-grain)" '
            'mask="url(#plate-silhouette)"/>')


def grain_definition():
    # A seeded screen keeps the vector masters reproducible and the paper
    # texture independent of SVG filters, raster resolution or renderer.
    from random import Random
    rng = Random(1858)
    dark, light = [], []
    for i in range(160):
        x, y = rng.uniform(.3,11.3), rng.uniform(.25,10.2)
        length, height = rng.uniform(.17,.54), rng.uniform(.10,.26)
        mark = (f'M{x:.2f} {y:.2f} q{length*.47:.2f} {-height:.2f} {length:.2f} {-.12*height:.2f} '
                f'q{-length*.14:.2f} {height:.2f} {-length:.2f} {.12*height:.2f}Z')
        (dark if i%3 else light).append(mark)
    return ('<defs><pattern id="ink-grain" width="11.64" height="10.56" patternUnits="userSpaceOnUse">'
            '<path fill="#573d20" opacity=".36" d="'+' '.join(dark)+'"/>'
            '<path fill="#fff6c8" opacity=".65" d="'+' '.join(light)+'"/></pattern></defs>')


GRAIN = grain_definition()


def write(stem,body):
    paper='<rect x=".5" y=".5" width="88" height="132" rx="6.0" fill="'+PAPER+'" stroke="#888884" stroke-width=".36"/>'
    (ROOT/f'{stem}.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 89 133" preserveAspectRatio="none">'+DEFS+GRAIN+paper+body+'</svg>\n')


def render():
    for s,suit in enumerate(SUITS):
        for rank in RANKS:
            idx=corner_rank(rank)
            body=court(s,rank) if rank>=10 else numbered(suit,rank)
            if rank in PLATE_REGISTRATION[suit]:
                size, dx, dy = PLATE_REGISTRATION[suit][rank]
                body = g(body, f'translate({44.5+dx:g} {66.5+dy:g}) scale({size:g}) translate(-44.5 -66.5)')
            write(f'card_{suit}_{rank:02}',printed_plate(body)+pintas(suit)+idx+g(idx,'rotate(180 44.5 66.5)'))
    write('card_back',back())

if __name__=='__main__':
    render()
