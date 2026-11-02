from PIL import Image, ImageOps
from pathlib import Path
src=Image.open('/mnt/data/cleaning_and_garden_supplies_catalogue.png').convert('RGB')
boxes={
  'two-stroke-500ml':(37,49,206,369),
  'nylon-line':(220,122,450,373),
  'pine-gel-5l':(453,88,707,375),
  'pine-gel-20l':(713,29,1073,375),
  'non-selective-20l':(1071,10,1413,369),
  'non-selective-1l':(27,376,159,680),
  'selective-20l':(169,383,409,683),
  'selective-5l':(401,443,627,689),
  'bleach-5l':(622,386,837,691),
  'toilet-paper':(838,439,1131,679),
  'two-stroke-20l':(1130,376,1415,685),
  'black-bags':(20,792,345,1032),
  'rake':(307,695,555,1058),
  'broom':(540,697,814,1061),
  'mop':(810,693,1081,1064),
  'broom-sticks':(1076,714,1403,1035)
}
out=Path('/mnt/data/stock-control-app/assets')
for name,box in boxes.items():
  cr=src.crop(box)
  canvas=Image.new('RGB',(480,480),(255,255,255))
  resized=ImageOps.contain(cr,(442,442),Image.Resampling.LANCZOS)
  canvas.paste(resized,((480-resized.width)//2,(480-resized.height)//2))
  canvas.save(out/(name+'.webp'),'WEBP',quality=88,method=6)
  print(name, (out/(name+'.webp')).stat().st_size)
