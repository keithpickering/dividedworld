# Record, written 2026-11-16. The plan's recipe (docs/plans/2026-11-16-steel-chair-dent-plan.md, Task 1) checked in numpy over 200 seeds against
# the plan's unit tests (hollow-lit quadrants, glint area, outward bend, pressed-in middle). Run: python3 -I 02-recipe.py
import numpy as np
def ss(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def make(seed,W=160,H=140):
    r=np.random.default_rng(seed)
    turn=r.uniform(0,2*np.pi); waves=[(r.uniform(-.1,.1),r.uniform(0,2*np.pi)) for _ in range(3)]
    lobes=[]
    for _ in range(2+int(3*r.random())):
        d=r.uniform(0,.3); a=r.uniform(0,2*np.pi); lobes.append((d*np.cos(a),d*np.sin(a),r.uniform(.12,.22),r.uniform(.3,.6)))
    lat=r.uniform(-.5,.5,(9,9))
    y,x=np.mgrid[0:H,0:W]; u=(x+.5)/W*2-1; v=(y+.5)/H*2-1
    rho=np.hypot(u,v); a=np.arctan2(v,u)
    r0=.5*(1+sum(A*np.cos(k*a+p) for (A,p),k in zip(waves,(2,3,5))))
    h=-np.exp(-2.2*(rho/r0)**2)
    for lu,lv,rr,dd in lobes: h-=dd*np.exp(-((u-lu)**2+(v-lv)**2)/rr**2)
    n=u*np.sin(turn)-v*np.cos(turn); t=u*np.cos(turn)+v*np.sin(turn)
    h-=.15*np.exp(-(n/.08)**2)*np.exp(-(t/.4)**2)
    h+=.12*np.exp(-((rho-1.05*r0)/.09)**2)
    gx=(u+1)/2*8; gy=(v+1)/2*8; ix=np.clip(gx.astype(int),0,7); iy=np.clip(gy.astype(int),0,7)
    fx=ss(0,1,gx-ix); fy=ss(0,1,gy-iy)
    c=(lat[iy,ix]*(1-fx)+lat[iy,ix+1]*fx)*(1-fy)+(lat[iy+1,ix]*(1-fx)+lat[iy+1,ix+1]*fx)*fy
    h+=.012*c*np.clip(-3*h,0,1)
    h*=1-ss(.8,.98,rho)
    return h,u,v,rho
L=np.array([-.5,-.6,.62]); L/=np.linalg.norm(L); Hh=L+[0,0,1]; Hh/=np.linalg.norm(Hh)
bad=0
for s in range(200):
    h,u,v,rho=make(s); W=h.shape[1];Hn=h.shape[0]
    dhv,dhu=np.gradient(h,2/Hn,2/W)
    N=np.dstack([-.065*dhu,-.065*dhv,np.ones_like(h)]); N/=np.linalg.norm(N,axis=2,keepdims=True)
    lam=N@L; flat=L[2]; g=(1-128/255)/(flat-lam.min()); shade=np.clip(1+(lam-flat)*g,128/255,1)
    soft=np.maximum(0,lam-flat); soft*=(71/255)/soft.max()
    P=40
    for _ in range(9):
        gl=np.maximum(0,(N@Hh)**P-Hh[2]**P)/(1-Hh[2]**P); gl*= (140/255)/gl.max()
        lt=np.minimum(140/255,soft+gl); frac=((lt>71/255)&(rho<1)).sum()/(rho<1).sum()
        if frac<=.04: break
        P*=1.5
    q1=shade[(u<-.1)&(v<-.1)&(rho<.5)].mean(); q2=shade[(u>.1)&(v>.1)&(rho<.5)].mean()
    # bend outward sectors
    sc=74/max(abs(dhu).max(),abs(dhv).max())  # (normalized units ~ proportional to px per axis)
    ring=(rho>.25)&(rho<.6); ang=np.arctan2(v,u); pos=0
    for k in range(16):
        m=ring&(ang>=-np.pi+k*np.pi/8)&(ang<-np.pi+(k+1)*np.pi/8)
        dot=(dhu*u+dhv*v)/np.maximum(rho,1e-9)
        pos+= dot[m].mean()>0
    ok=q1<q2 and frac<=.04 and pos>=12 and h[rho<.3].mean()<h[(rho>.5)&(rho<.7)].mean()
    if not ok: bad+=1; print(s,round(q1,3),round(q2,3),round(frac,3),pos)
print("bad",bad,"of 200")
