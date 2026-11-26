"""Redraw the 40-card Retruco baraja and its shared back with stock Python."""
from pathlib import Path
from engraving import *
from suits import numbered
from courts import court

ROOT=Path(__file__).resolve().parent
SUITS=('coins','cups','swords','clubs')
RANKS=(1,2,3,4,5,6,7,10,11,12)


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
            idx=f'<text x="11.2" y="17.2" fill="{INK}" font-family="Georgia,serif" font-size="6.2">{rank}</text>'
            body=court(s,rank) if rank>=10 else numbered(suit,rank)
            body=g(body,'translate(.60 4.20) scale(.986 .935)')
            write(f'card_{suit}_{rank:02}',body+pintas(suit)+idx+g(idx,'rotate(180 44.5 66.5)'))
    write('card_back',back())

if __name__=='__main__':
    render()
