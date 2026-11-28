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

# Optical placement of the original engraved plates, inside the fixed pintas.
# Scale about the card center, then translate in viewBox units. Fitting the
# whole plate preserves the shape of each emblem and keeps both corners clear.
PLATE_FIT = {
    'coins': {1: (.95, 0, 0), 4: (.95, 0, 0), 5: (.98, 0, 0), 6: (.98, 0, 0),
              10: (.90, 1, 1.5), 11: (.90, 2.5, -2), 12: (.90, 0, -.5)},
    'cups': {4: (.95, 0, 0), 5: (.98, 0, 0), 7: (.98, 0, 0),
             10: (.92, 0, 0), 11: (.90, 0, -1.5), 12: (.90, -1, -1)},
    'swords': {2: (.96, 0, 0), 3: (.94, 0, 0), 4: (.95, 0, 2), 6: (.98, 0, 0),
               10: (.92, 2, 0), 11: (.86, 0, 0), 12: (.92, -1, -2)},
    'clubs': {1: (1, -2, 0), 4: (.91, 2.5, -2), 5: (.92, 1.5, -1.5),
              6: (.91, -1, 1), 7: (.95, 0, 0), 10: (.90, 2.5, .5),
              11: (.90, 0, -2), 12: (.87, -1, 1.5)},
}


def corner_rank(rank):
    letters = ''
    offset = 0
    for digit in str(rank):
        width, outline = FIGURES[digit]
        letters += f'<path transform="translate({offset:g})" d="{outline}" fill-rule="evenodd"/>'
        offset += width + 1.15
    return g(f'<g fill="#211b17">{letters}</g>', 'translate(10.1 11.8)', name=f'Rank {rank}')


def pintas(suit):
    """Traditional top and bottom suit breaks in the printed inner frame."""
    n=SUITS.index(suit)
    left,right=8,81
    breaks=[left+(right-left)*i/(n+1) for i in range(1,n+1)]
    # Flat-ended ink bands stay distinct after the atlas is mipmapped.
    spans=[(a,b) for a,b in zip([left]+[x+2.8 for x in breaks],[x-2.8 for x in breaks]+[right])]
    b=line(f'M{left} 9.6 V123.4 M{right} 9.6 V123.4',.51)
    for y in (9.6,123.4):
        for x0,x1 in spans:
            b+=f'<path d="M{x0:.2f} {y}H{x1:.2f}" stroke="{INK}" stroke-width=".94" stroke-linecap="butt"/>'
    return g(b,name=f'{n} suit breaks on each horizontal rule')


def back():
    b=p('M5.1 5.1 H83.9 V127.9 H5.1Z',RED,.5)
    for off in (6.2,7.1,8.1,9.4):
        col=PALE if off in (7.1,9.4) else CRIMSON
        b+=p(f'M{off} {off} H{89-off} V{133-off} H{off}Z','none',.36,col)
    for i in range(5):
        for j in range(8):
            x,y=13+i*15.8,13.4+j*15.1
            for a in range(0,360,45):
                b+=put(p('M0 -.4 Q-2.0 -2.1 -1.0 -4 Q.3 -5 .1 -6.2 Q2.65 -3.7 1.5 -2.1Z','none',.23,'#efaa72'),x,y,.92,a)
    for angle in (0,180):
        ornament=''
        for mirror in ('','translate(89 0) scale(-1 1)'):
            corner=p('M10.4 29.8 Q10.9 14.3 25 11.2 Q29.1 10.5 31.6 11 Q22.1 12.5 20.2 18.4 Q17.8 15.8 15.2 19.9 Q15.7 23.5 12.2 25.7Z',GOLD,.43)
            corner+=line('M12 23.8 Q13.6 15.1 23.5 12.7 M14.1 20.2 Q15.1 16.5 19.4 14.7',.30,CRIMSON)
            ornament+=g(corner,mirror)
        b+=g(ornament,f'rotate({angle} 44.5 66.5)')
    b+=c(44.5,66.5,20.4,PALE)+c(44.5,66.5,18.6,BLUE)+c(44.5,66.5,17,'none',PALE,.4)
    for j in range(16):
        b+=g(put(palmette(),44.5,61.9,1.34),f'rotate({j*22.5} 44.5 66.5)')
    b+=c(44.5,66.5,6.4,RED)+flower(44.5,66.5,1.55,8,PALE)
    return b


def write(stem,body):
    paper='<rect x=".5" y=".5" width="88" height="132" rx="4.8" fill="'+PAPER+'" stroke="#a29b8a" stroke-width=".45"/>'
    (ROOT/f'{stem}.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240" viewBox="0 0 89 133" preserveAspectRatio="none">'+DEFS+paper+body+'</svg>\n')


def render():
    for s,suit in enumerate(SUITS):
        for rank in RANKS:
            idx=corner_rank(rank)
            body=court(s,rank) if rank>=10 else numbered(suit,rank)
            body=g(body,'translate(.60 4.20) scale(.986 .935)')
            if rank in PLATE_FIT[suit]:
                scale, dx, dy = PLATE_FIT[suit][rank]
                body = g(body, f'translate({44.5 + dx:g} {66.5 + dy:g}) scale({scale:g}) translate(-44.5 -66.5)')
            write(f'card_{suit}_{rank:02}',body+pintas(suit)+idx+g(idx,'rotate(180 44.5 66.5)'))
    write('card_back',back())

if __name__=='__main__':
    render()
