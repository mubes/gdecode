(40mm x 40mm square cut, 5mm deep)
(Tool: 6mm end mill)
(Material: Assumed aluminum/wood)
(Feed rate: 1000 mm/min, Spindle: 8000 RPM)

G21 (Metric units)
G17 G54 G90 (XY plane, work offset, absolute positioning)
G0 X0 Y0 Z50 (Safe rapid to start position)

(Spindle on clockwise)
M3 S8000

(Pocket dimensions: 40mm x 40mm)
(Start point: bottom-left corner at 0,0)
(Cut depth: 5mm in 2 passes of 2.5mm each)

(Pass 1: 2.5mm depth)
G0 X5 Y5 (Start inside the pocket, 5mm offset from edge for tool radius)
G1 Z-2.5 F200 (Plunge to first depth)
G1 X35 F1000 (Cut right)
G1 Y35 (Cut up)
G1 X5 (Cut left)
G1 Y5 (Cut down - completes first pass square)

(Pass 2: 5mm depth - final)
G1 Z-5.0 F200 (Plunge to final depth)
G1 X35 F1000 (Cut right)
G1 Y35 (Cut up)
G1 X5 (Cut left)
G1 Y5 (Cut down - completes final square)

(Return to safe height)
G0 Z50
M5 (Spindle off)
M30 (Program end)