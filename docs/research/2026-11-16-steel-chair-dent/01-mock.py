# Record, written 2026-11-16. The mock the owner approved for Steel Chair's dent (docs/plans/2026-11-16-steel-chair-dent-design.md).
# A direction check in numpy, not game code: run with python3 -I 01-mock.py from this folder; it writes 01-mock.png.
import numpy as np
from PIL import Image, ImageDraw, ImageFont
rng=np.random.default_rng(7)
W,H=520,420; S=2
bg=np.array([0x22,0x34,0xa6],float)/255
img=np.ones((H*S,W*S,3))*bg
# text
t=Image.fromarray((img*255).astype(np.uint8)); d=ImageDraw.Draw(t)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
except: f=None
lines=["So I said the new level editor","was fine, actually, and then","somebody threw a chair at me.","Which I think proves my point."]
for i,l in enumerate(lines): d.text((40,40+i*52),l,fill=(200,210,240),font=f)
img=np.asarray(t).astype(float)/255
def dent(cx,cy,R,seed):
    r=np.random.default_rng(seed)
    y,x=np.mgrid[0:H*S,0:W*S].astype(float)
    hgt=np.zeros_like(x)
    # irregular main bowl: radius modulated by angular harmonics
    a=np.arctan2(y-cy,x-cx); dist=np.hypot(x-cx,y-cy)
    rad=R*(1+sum(r.uniform(-.12,.12)*np.cos(k*a+r.uniform(0,6.28)) for k in (2,3,5)))
    hgt-=np.exp(-(dist/rad)**2*2.2)
    # knuckle lobes
    for _ in range(3):
        ox,oy=r.normal(0,R*.45,2); rr=R*r.uniform(.25,.45)
        hgt-=r.uniform(.3,.6)*np.exp(-((x-cx-ox)**2+(y-cy-oy)**2)/(rr**2))
    # one crease (chair seat edge): a soft linear trough across the bowl
    th=r.uniform(0,np.pi); n=(x-cx)*np.sin(th)-(y-cy)*np.cos(th); along=(x-cx)*np.cos(th)+(y-cy)*np.sin(th)
    hgt-=.2*np.exp(-(n/(R*.11))**2)*np.exp(-(along/(R*.8))**2)
    # raised lip just outside the rim
    hgt+=.12*np.exp(-((dist-rad*1.05)/(R*.18))**2)
    return hgt
h=dent(300*S,150*S,85*S,3)+0.7*dent(150*S,300*S,60*S,11)
# small-scale crumple noise, blurred
from PIL import ImageFilter
nz=Image.fromarray((rng.normal(128,40,(H*S//14,W*S//14))).clip(0,255).astype(np.uint8)).resize((W*S,H*S),Image.BICUBIC)
h+=0.012*(np.asarray(nz)/255-.5)*np.clip(-h*3,0,1)
k=22.0
gy,gx=np.gradient(h*k*S/ S)
N=np.dstack([-gx,-gy,np.ones_like(h)]); N/=np.linalg.norm(N,axis=2,keepdims=True)
L=np.array([-.5,-.6,.62]); L/=np.linalg.norm(L)
lam=(N@L); flat=L[2]
shade=np.clip(1+(lam-flat)*1.3,0.55,1.0)            # multiply layer
Hh=L+np.array([0,0,1]); Hh/=np.linalg.norm(Hh)
spec=np.clip(N@Hh,0,1)**40*0.55+np.clip(lam-flat,0,1)*0.35   # screen layer
# displacement of the words from the same height map
dy,dx=np.gradient(h)
s=14*S*1.6
yy,xx=np.mgrid[0:H*S,0:W*S]
sx=np.clip(xx+dx*s,0,W*S-1).astype(int); sy=np.clip(yy+dy*s,0,H*S-1).astype(int)
out=img[sy,sx]
out=out*shade[...,None]
out=1-(1-out)*(1-spec[...,None])
Image.fromarray((out.clip(0,1)*255).astype(np.uint8)).save('01-mock.png')
