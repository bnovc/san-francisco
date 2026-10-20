import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *
reset_scene()
post = cylinder_bottom("post", 0.06, 4.0, material="iron_painted")
head = sphere("head", 0.25, (0, 0, 4.2), material="emissive_warm")
lamp = join([post, head], "smoke_lamp")
set_origin_bottom_center(lamp)
export_glb(lamp, "smoke/lamp")
write_manifest("smoke")
