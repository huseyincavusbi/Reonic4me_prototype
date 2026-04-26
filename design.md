PHASE 1 DISCOVERY GOAL: Hook the user with their own home’s data.
User action: Enters address
UI: A 3D view of their roof appears
Narrative: We’ve analyzed your roof. You have space for 18 panels, which could save you €1,350 every year. Let’s find your best path to claim those savings.
PHASE 2 LOGIC
GOAL: Bucket user into a “popular path” using dataset logic

Q1 (Home age): “When was your home built?” [Pre-1990 / 1990-2010 / Post-2010]
Why: Decides if Step 1 is “Insulation” or “Solar”
Q2 (User Goal): “What is your top priority?” [Lowering bills / stopping gas / self-sufficiency]
Why: Determines Archetype (Optimizer, Pioneer, Autarky)
Q3 (EV): “Do you have or plan to get an EV?” [y/n]
Why: Triggers “Wallbox” step and increases Battery size recommendation
Q4 (The Bill): “What is your average monthly electric bill?” [slider]
Why: Callibrates the ROI and Payback Time metrics
PHASE 3 ALIGNMENT
GOAL: Use social proof to validate the choice.

The Reveal: A “Path Card” slides in: You are a Green Pioneer.
The Narrative: “Based on your 1985 home and your goal to stop using gas, 72% of neighbors in your area followed this 3-step sequence”
The Reward: A “Projected Savings” counter appears in the header
PHASE 4 ROADMAP
GOAL: Show that each step enables the next (vertical timeline view)

Step 1: The Foundation [Efficiency] “Since your home was built in 1985, we start with a loft check. Fixing leaks now means you can buy a smaller Heat Pump in Step 3.”
Step 2: The Power [Solar + Storage] “We’ve mapped 12 panels to your roof scan. WE added a 10kWh battery because you mentioned an EV is in your future.”
Step 3: The Switch [Heat Pump] “The final move. Swapping your gas boiler for a heat pump. Your home is now fully optimized.”
PHASE 5 ACTION
GOAL: Empower the user to talk to a pro.

The Deliverable: “Download My Installer Brief”
The Content: A professional PDF containing:
Roof Geometry (Area + Tilt)
Recommended Hardware (Solar kWp / Battery kWh / HP Size)
The Narrative Why (e.g. “Insulated in 2026”)
The Call to Action: “Connect with 3 vetted installers with experience on homes like yours”
DESIGN CLARITY CHECKLIST
GOAL: Uniformity for the wireframe and MVP

The Bridge Text: Ensure every step has a sentence explaining how it helps the next step (e.g. “Insulation saves you 4k on the heat pump”)
The Social Proof Badge: Always keep a “Popular Choice” badge visible on the recommended hardware.
The Single Result: Don’t show all archetypes as a menu – show the one that matches their logic, but allow for modification of variables
VARIABLE REFINEMENT

User Refinement
The Downstream Impact
The Narrative Logic
Increase Insulation
Shrinks Heat Pump Size
"Better insulation means you can use a smaller, quieter 5kW pump instead of 9kW."
Add a second EV
Grows Battery & Solar
"To keep your second car charged, we've added 4 panels and 5kWh of storage."
Lower Target Temp
Extends Battery Life
"By setting your home to 19°C instead of 21°C, your battery now lasts 4 hours longer."
NARRATIVE HOOKS FOR REFINEMENT
GOAL: Guide user through refinement process with hints so they don’t feel overwhelmed.
Sweet Spot: “You’re currently at 85% energy independence. Adding 2 more panels would get you to 95%, but increases the payback period by 3 years.”
Efficiency Over Hardware: “We noticed your heating bills are high. You could buy a massive heat pump or spend half that amount on attic insulation and buy a smaller pump.”  
VISUAL DESIGN ELEMENTS
GOAL: Feel cohesive with existing Reonic UI. 
Colors: background white, font black. accents: Blue 
#4A5685
Red 
#EF5446
Green 
#BCDA8A
Yellow 
#F2D473
font: geist sans