from PIL import Image,ImageDraw,ImageFont,ImageFilter
from pathlib import Path
import json,subprocess,math,concurrent.futures
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output';OUT.mkdir(exist_ok=True);TMP=ROOT/'edit';TMP.mkdir(exist_ok=True)
SCENES=json.loads((ROOT/'src/scenes.json').read_text());TL=json.loads((ROOT/'captures/timeline.json').read_text())
TIMES={x['name']:x for x in TL['timeline']}
if TL.get('errors'):raise ValueError('Cannot render a failed recording')
if TL.get('workflow')!='quick-start':raise ValueError('Fresh quick-start capture required; legacy footage is not publishable')
for scene in SCENES:
 if scene['name'] not in ('intro','outro'):
  if scene['name'] not in TIMES:raise ValueError('Missing scene '+scene['name'])
  tm=TIMES[scene['name']]
  if tm['end']<=tm['start']:raise ValueError('Invalid scene timing')
  scene['duration']=math.ceil(max(scene['duration'],tm['end']-tm['start']))
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
W,H=1920,1080;green='#173F35';muted='#45695E';mint='#EDF6F1';lime='#A9E7BF'
def font(size,bold=False):return ImageFont.truetype(BOLD if bold else FONT,size)
def wrap(text,f,width):
 lines=[]
 for para in text.split('\n'):
  line=''
  for word in para.split():
   new=(line+' '+word).strip()
   if f.getlength(new)>width and line:lines.append(line);line=word
   else:line=new
  lines.append(line)
 return lines
def textblock(draw,xy,text,size,color,width=480,bold=False,leading=1.28):
 x,y=xy;f=font(size,bold)
 for line in wrap(text,f,width):draw.text((x,y),line,font=f,fill=color);y+=round(size*leading)
 return y
logo=Image.open(ROOT/'src/blumr-logo.png').convert('RGBA')
# Use the existing white logo on a forest-green background.
def brand(im,x,y,width):
 lg=logo.copy();lg.thumbnail((width,round(width/3)));im.alpha_composite(lg,(x,y))
def background(scene,index):
 title=scene['name'] in ('intro','outro')
 im=Image.new('RGBA',(W,H),green if title else mint);d=ImageDraw.Draw(im)
 if title:
  # Concentric arcs echo the leaf mark while keeping the type clear.
  for k in range(6):
   r=380+k*100;d.ellipse((W-220-r,-240-r,W-220+r,-240+r),outline='#285749',width=2)
  brand(im,90,56,350)
  if scene['name']=='intro':
   d.text((96,238),'HOW BLUMR WORKS',font=font(24,True),fill=lime)
   textblock(d,(88,322),scene['title'],86,'#FFFFFF',1500,True,1.2)
   d.text((96,616),scene['body'],font=font(35),fill='#C8DFD3')
   x=96
   for n,label in enumerate(['Job context','Candidate evidence','Recruiter judgment']):
    bw=int(font(25).getlength(label))+72
    d.rounded_rectangle((x,774,x+bw,848),radius=37,fill='#2B594B')
    d.text((x+36,795),label,font=font(25),fill='#FFFFFF');x+=bw+18
  else:
   textblock(d,(90,310),scene['title'],68,'#FFFFFF',1560,True,1.25)
   d.text((96,644),scene['body'],font=font(35),fill=lime)
   d.text((96,745),'Built by recruiters for recruiters.',font=font(29),fill='#C8DFD3')
   d.rounded_rectangle((96,841,402,923),radius=41,fill=lime)
   d.text((145,862),'blumr.io',font=font(33,True),fill=green)
  d.text((96,1006),'Illustrative demo · Fictional candidate data',font=font(19),fill='#BCD5C7')
 else:
  d.rounded_rectangle((74,42,268,118),radius=18,fill=green);brand(im,83,49,176)
  d.text((303,66),'PRODUCT WALKTHROUGH',font=font(22,True),fill=muted)
  d.text((1710,67),f'{index:02d} / 11',font=font(23,True),fill=muted)
  d.line((78,147,1842,147),fill='#D2E5D8',width=2)
  d.text((80,224),scene['chapter'],font=font(16,True),fill='#39765B')
  y=textblock(d,(76,285),scene['title'],48,green,490,True,1.23)
  y=textblock(d,(80,y+40),scene['body'],28,muted,450,False,1.45)
  d.rounded_rectangle((80,837,549,895),radius=16,fill='#D9EEE0')
  d.text((101,855),scene['tag'],font=font(20,True),fill=green)
  # The recording sits in this inset; no imitation UI is drawn.
  d.rounded_rectangle((591,182,1845,978),radius=26,fill='#C9DED1')
  d.rounded_rectangle((595,178,1841,970),radius=26,fill='#F7FBF8')
  d.text((80,1017),'Illustrative demo · Fictional candidates and sample assessments',font=font(18),fill=muted)
  d.text((1657,1015),'blumr.io',font=font(23,True),fill=green)
 return im

def run(scene,index):
 name=scene['name'];dur=scene['duration'];bg=TMP/(name+'.png');background(scene,index).convert('RGB').save(bg)
 dest=TMP/(name+'.mp4');cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y']
 cmd+=['-loop','1','-framerate','30','-i',str(bg)]
 if name in TIMES:
  tm=TIMES[name].copy();x,y,w,h=scene['crop'];
  span=tm['end']-tm['start']
  cmd+=['-i',str(ROOT/'captures/walkthrough.webm')]
  filt=f'[1:v]trim=start={tm['start']}:end={tm['end']},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={max(0,dur-span)+1},fps=30,crop={w}:{h}:{x}:{y},scale=1202:748:force_original_aspect_ratio=decrease,pad=1202:748:(ow-iw)/2:(oh-ih)/2:color=0xF7FBF8,setsar=1[v];[0:v][v]overlay=617:202:shortest=1,format=yuv420p[out]'
 else:
  filt=f'[0:v]format=yuv420p[out]'
 cmd+=['-filter_complex',filt,'-map','[out]','-t',str(dur),'-r','30','-an','-c:v','libx264','-preset','veryfast','-crf','24','-threads','2',str(dest)]
 subprocess.run(cmd,check=True);print('Rendered',name,flush=True)
 return dest
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:parts=list(ex.map(lambda x:run(*x),[(s,i) for i,s in enumerate(SCENES)]))
 (TMP/'concat.txt').write_text(''.join("file '"+str(p)+"'\n" for p in parts))
 subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(TMP/'concat.txt'),'-c','copy','-movflags','+faststart',str(OUT/'Blumr_Tutorial_20261009.mp4')],check=True)
 elapsed=0;srt=[];script=['# blumr — refreshed product tutorial','', 'Caption-led edit of the real blumr interface, using fictional profiles and scripted sample assessments. No production user data is included.','', 'Voiceover script (not recorded in this version):','']
 for i,s in enumerate(SCENES):
  start=elapsed;elapsed+=s['duration'];ts=lambda t:f'{int(t//3600):02}:{int(t//60)%60:02}:{int(t)%60:02},000'
  caption=s['title'].replace('\n',' ')+' '+s['body'];srt.append(f'{i+1}\n{ts(start)} --> {ts(elapsed)}\n{caption}\n')
  script += [f"## {start:02d}–{elapsed:02d} seconds · {s['name']}",s['voice'],'']
 (OUT/'Blumr_Demo_Captions.srt').write_text('\n'.join(srt));(OUT/'Blumr_Demo_Voiceover.md').write_text('\n'.join(script))
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(OUT/'Blumr_Tutorial_20261009.mp4')]))
 assert abs(float(probe['format']['duration'])-elapsed)<0.05, 'Video duration does not match the storyboard'
 (OUT/'manifest.json').write_text(json.dumps({'source_sha':TL['source_sha'],'recorded_at':TL['recorded_at'],'duration':elapsed,'workflow':TL['workflow'],'transitions':'hard-cuts','speed':1},indent=2))
 print('COMPLETE',elapsed,'seconds',flush=True)
