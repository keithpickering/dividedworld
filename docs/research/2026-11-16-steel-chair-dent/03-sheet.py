# Record, written 2026-11-16. Eight dents from 02-recipe.py, shaded and lit as the plan says, on the light theme's post blue. Run from this folder: python3 -I 03-sheet.py
import numpy as np, sys
from PIL import Image
sys.argv=['x']; exec(open('02-recipe.py').read().split('bad=0')[0])
bg=np.array([0x22,0x34,0xa6])/255
tiles=[]
for s in range(8):
    h,u,v,rho=make(s,320,280)
    dhv,dhu=np.gradient(h,2/280,2/320)
    N=np.dstack([-.065*dhu,-.065*dhv,np.ones_like(h)]); N/=np.linalg.norm(N,axis=2,keepdims=True)
    lam=N@L; flat=L[2]; g=(1-128/255)/(flat-lam.min()); shade=np.clip(1+(lam-flat)*g,128/255,1)
    soft=np.maximum(0,lam-flat); soft*=(71/255)/soft.max(); P=40
    for _ in range(9):
        gl=np.maximum(0,(N@Hh)**P-Hh[2]**P)/(1-Hh[2]**P); gl*=(140/255)/gl.max()
        lt=np.minimum(140/255,soft+gl)
        if ((lt>71/255)&(rho<1)).sum()/(rho<1).sum()<=.04: break
        P*=1.5
    t=np.ones((300,340,3))*bg; t[10:290,10:330]=1-(1-bg*shade[...,None])*(1-lt[...,None]); tiles.append(t)
img=np.vstack([np.hstack(tiles[:4]),np.hstack(tiles[4:])])
Image.fromarray((img*255).astype(np.uint8)).save('03-sheet.png')
