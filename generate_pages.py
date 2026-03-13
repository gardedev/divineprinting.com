"""Generate individual product HTML pages for Divine Printing."""
import os

OUT = "/home/ubuntu/.openclaw/workspace/divineprinting/products"
os.makedirs(OUT, exist_ok=True)

PRODUCTS = [
    {
        "slug": "church-vinyl-banner",
        "image": "../images/vinyl-banner.jpg",
        "badge": "Best Seller",
        "category": "Banners & Flags",
        "name": "Church Vinyl Banner",
        "tagline": "Heavy-duty outdoor banners crafted for your ministry — built to last through every season of service.",
        "scripture": "Therefore go and make disciples of all nations...",
        "scripture_ref": "Matthew 28:19",
        "specs": [
            ("Material", "510g PVC Vinyl"),
            ("Print Method", "UV Curing / Eco-Solvent Ink"),
            ("Resolution", "Up to 1440 dpi"),
            ("UV Resistance", "Up to 5 years"),
            ("Max Width", "5 meters (length unlimited)"),
            ("Finishing", "Double-sewn edges + metal grommets"),
        ],
        "features": [
            "Cross, dove, and scripture design options available",
            "Weatherproof — rain, sun, and wind resistant",
            "Double-thread sewn edges for maximum durability",
            "Metal grommets at all corners for secure hanging",
            "Full-color printing at up to 1440 dpi",
            "Rush production available for Sunday deadlines",
        ],
        "description": """Church Vinyl Banners are one of our most popular products — and for good reason. Whether you're announcing an upcoming revival, welcoming new visitors, promoting Vacation Bible School, or sharing a scripture verse with your community, a well-designed vinyl banner is one of the most effective tools your ministry can have.

Our 510g premium vinyl offers the highest durability we carry. UV-cured ink ensures your banner stays vibrant for up to 5 years outdoors, even in direct sunlight. Each banner is finished with double-folded, double-thread sewn edges and metal grommets so it can be mounted securely anywhere — on poles, fences, building facades, or event frames.

Every banner we produce can be customized with religious imagery including crosses, doves, praying hands, and scripture text. Upload your own design or work with our team to create something that truly represents your congregation.""",
        "use_cases": [
            ("⛪", "Sunday service announcements"),
            ("📖", "Scripture & message banners"),
            ("🎉", "VBS, revival & special events"),
            ("🌟", "Holiday & seasonal displays"),
            ("🤝", "Community outreach programs"),
            ("🏫", "Church school & youth ministry"),
        ],
        "sizes": ["2×4 ft", "3×6 ft", "4×8 ft", "4×10 ft", "Custom"],
        "related": ["mesh-banner", "fabric-sanctuary-banner", "church-yard-sign"],
    },
    {
        "slug": "mesh-banner",
        "image": "../images/mesh-banner.jpg",
        "badge": "Outdoor",
        "category": "Banners & Flags",
        "name": "Wind-Resistant Mesh Banner",
        "tagline": "Breathable mesh banners that stand up to wind — ideal for fences, outdoor stages, and revival tents.",
        "scripture": "The wind blows where it wishes, and you hear its sound...",
        "scripture_ref": "John 3:8",
        "specs": [
            ("Material", "300gsm / 380gsm Vinyl Mesh"),
            ("Print Method", "Eco-Solvent / UV Curing Ink"),
            ("Resolution", "Up to 1440 dpi"),
            ("UV Resistance", "1–3 years"),
            ("Wind Resistance", "High — 30–40% open mesh"),
            ("Finishing", "Double-sewn edges + grommets"),
        ],
        "features": [
            "Perforated mesh allows airflow — won't act as a sail",
            "Perfect for chain-link fences at church events",
            "Full-color religious designs printed at high resolution",
            "Available in 300gsm and 380gsm weights",
            "Metal grommets at regular intervals for secure tie-down",
            "Great for outdoor revivals, tent events, and fairs",
        ],
        "description": """Mesh banners are the smart choice when you need outdoor signage in windy conditions. Unlike solid vinyl, the open mesh structure lets wind pass through — preventing the banner from acting as a sail and reducing stress on mounting points.

These are ideal for hanging on chain-link fences around your church property, along scaffolding, at outdoor events, or on the perimeter of revival tents. The perforated material still provides a bold, clear visual from a distance, while allowing air to flow freely through the surface.

We offer 300gsm for lighter-duty applications and 380gsm for more permanent or high-traffic installations. All mesh banners include metal grommets and double-sewn edges as standard.""",
        "use_cases": [
            ("⛺", "Revival tent perimeter signage"),
            ("🏗️", "Scaffolding & construction wraps"),
            ("🏟️", "Event fencing & barriers"),
            ("🌬️", "High-wind outdoor locations"),
            ("🤝", "Community outreach events"),
            ("⛪", "Church parking lot displays"),
        ],
        "sizes": ["3×6 ft", "4×8 ft", "4×20 ft", "Custom"],
        "related": ["church-vinyl-banner", "feather-teardrop-flag", "ministry-canopy-tent"],
    },
    {
        "slug": "fabric-sanctuary-banner",
        "image": "../images/fabric-banner.jpg",
        "badge": "Indoor",
        "category": "Banners & Flags",
        "name": "Fabric Sanctuary Banner",
        "tagline": "Elegant indoor fabric banners that bring warmth and reverence to your worship space.",
        "scripture": "Praise Him in His sanctuary; praise Him in His mighty heavens.",
        "scripture_ref": "Psalm 150:1",
        "specs": [
            ("Material", "250gsm Polyester Fabric"),
            ("Print Method", "Thermal Sublimation"),
            ("Resolution", "Up to 1440 dpi"),
            ("UV Resistance", "3–6 months (indoor)"),
            ("Finish", "Soft fabric, no glare"),
            ("Hanging", "Rod pocket or grommets"),
        ],
        "features": [
            "Soft fabric feel — elegant and dignified for sanctuaries",
            "No light glare — perfect for photography and video",
            "Thermal sublimation printing for vibrant, lasting color",
            "Cross, dove, flame, and stained-glass design options",
            "Rod pocket finish available for easy hanging",
            "Lightweight and portable — ideal for traveling ministries",
        ],
        "description": """Fabric Sanctuary Banners bring a different kind of presence to your worship space. Unlike vinyl, fabric has a soft, dignified look that suits the reverence of a sanctuary environment. These banners drape beautifully and photograph well without any of the glare you'd get from a glossy vinyl surface.

Using thermal sublimation printing, we achieve vibrant full-color imagery that becomes part of the fabric itself — it won't peel, crack, or fade under normal indoor conditions. 

Popular designs include crosses with rays of light, descending doves, flames representing the Holy Spirit, stained-glass inspired patterns, and scripture passages in elegant typography. These are perfect for displaying behind the pulpit, along the walls of your sanctuary, or as part of seasonal decorations for Christmas, Easter, and Pentecost.""",
        "use_cases": [
            ("⛪", "Behind the pulpit / altar area"),
            ("🕊️", "Sanctuary wall décor"),
            ("📸", "Photography-friendly backdrops"),
            ("🎄", "Seasonal worship decorations"),
            ("✈️", "Traveling & mobile ministries"),
            ("🎭", "Baptism & ceremony backdrops"),
        ],
        "sizes": ["2×4 ft", "2×6 ft", "3×6 ft", "4×8 ft", "Custom"],
        "related": ["stage-backdrop-banner", "retractable-rollup-banner", "church-vinyl-banner"],
    },
    {
        "slug": "custom-ministry-flag",
        "image": "../images/flag.jpg",
        "badge": "Custom",
        "category": "Banners & Flags",
        "name": "Custom Ministry Flag",
        "tagline": "Fly your faith — custom flags for churches, ministries, and congregations.",
        "scripture": "As for me and my house, we will serve the Lord.",
        "scripture_ref": "Joshua 24:15",
        "specs": [
            ("Material", "75D or 100D Polyester"),
            ("Standard Size", "3×5 ft"),
            ("Custom Sizes", "Available"),
            ("Print", "Full-color"),
            ("Sides", "Single or double-sided"),
            ("Header", "Canvas header with grommets"),
        ],
        "features": [
            "Feature your church logo, cross, or ministry crest",
            "Available in standard 3×5ft or any custom size",
            "Durable 75D or 100D polyester for outdoor use",
            "Double-sided printing available for visibility from both sides",
            "Canvas header with brass grommets for pole mounting",
            "Vibrant colors that hold up in sun and rain",
        ],
        "description": """A custom ministry flag is one of the most visible statements of identity your church can make. Whether flown from a pole outside your building, carried in a processional, or used at outdoor events and crusades, a flag bearing your church name, cross, or ministry emblem broadcasts your mission with dignity and pride.

We print on 75D or 100D polyester — a durable, weather-resistant fabric that holds color well and flies cleanly in the wind. Standard size is 3×5ft to fit most flagpoles, but we can produce any size you need.

For ministries that want visibility from both sides (such as processional or event flags), we offer double-sided printing with a center liner to prevent show-through.""",
        "use_cases": [
            ("🏛️", "Flagpole outside church"),
            ("🎺", "Processional & worship flags"),
            ("⛺", "Outdoor crusades & revivals"),
            ("🏅", "Ministry events & conferences"),
            ("🏫", "Christian schools & academies"),
            ("🌍", "Mission trip representation"),
        ],
        "sizes": ["3×5 ft (standard)", "4×6 ft", "5×8 ft", "Custom"],
        "related": ["feather-teardrop-flag", "church-vinyl-banner", "ministry-canopy-tent"],
    },
    {
        "slug": "feather-teardrop-flag",
        "image": "../images/feather-flag.jpg",
        "badge": "Event Favorite",
        "category": "Banners & Flags",
        "name": "Feather & Teardrop Flag",
        "tagline": "Eye-catching swooper flags that draw crowds to your outdoor ministry events.",
        "scripture": "Stand firm, then, and do not let yourselves be burdened again by a yoke of slavery.",
        "scripture_ref": "Galatians 5:1",
        "specs": [
            ("Shapes", "Feather, Teardrop, Rectangular"),
            ("Heights", "2.8m, 3.4m, 4m, 4.5m, 5m, 5.5m"),
            ("Material", "Polyester Fabric"),
            ("Print", "Full-color, single or double-sided"),
            ("Base Options", "Spike (ground), Cross base, Water base"),
            ("Pole", "Fiberglass included"),
        ],
        "features": [
            "6 height options from 2.8m to 5.5m",
            "Feather, teardrop, and rectangular shape choices",
            "Ground spike included for outdoor grass installation",
            "Cross base available for indoor / hard surface use",
            "Vivid full-color printing with your church design",
            "Lightweight and easy to assemble — no tools needed",
        ],
        "description": """Feather and teardrop flags are designed to be noticed. Their distinctive curved shapes create movement in even the lightest breeze, drawing the eye from a distance and signaling to passersby that something is happening at your location.

These are the perfect attention-grabbers for outdoor events — place them along the sidewalk before a revival, flank your ministry tent at a fair or festival, or line the entrance to your church for special services. Available in heights up to 5.5 meters, they're visible from a considerable distance.

Each flag comes with a fiberglass pole and your choice of base: a ground spike for installation in grass, or a cross base for indoor and hard surface use. We print your design in full color — bring your church logo, a bold cross, or a custom graphic and we'll make it stand out.""",
        "use_cases": [
            ("🎪", "Event & festival entrances"),
            ("⛺", "Revival & crusade perimeter"),
            ("🛒", "Sidewalk & parking lot draws"),
            ("🏟️", "Sports ministry events"),
            ("🎄", "Holiday & seasonal services"),
            ("📢", "Community outreach attention"),
        ],
        "sizes": ["2.8m", "3.4m", "4.0m", "4.5m", "5.0m", "5.5m"],
        "related": ["custom-ministry-flag", "ministry-canopy-tent", "church-vinyl-banner"],
    },
    {
        "slug": "retractable-rollup-banner",
        "image": "../images/rollup-banner.jpg",
        "badge": "Same-Day Available",
        "category": "Event Displays",
        "name": "Retractable Roll-Up Banner",
        "tagline": "Professional retractable banners for church lobbies, stages, and events.",
        "scripture": "For God so loved the world that He gave His one and only Son...",
        "scripture_ref": "John 3:16",
        "specs": [
            ("Width Options", "80cm or 85cm"),
            ("Height", "200cm"),
            ("Frame", "Aluminum alloy — Economy & Luxury"),
            ("Material", "Polyester banner"),
            ("Production", "Same-day available"),
            ("Includes", "Carry bag"),
        ],
        "features": [
            "Pulls out and retracts in seconds — no tools needed",
            "Economy and luxury aluminum stand options",
            "Sermon series, welcome, and scripture designs available",
            "Same-day production on select orders",
            "Includes protective carry bag for easy transport",
            "Stable base suitable for lobby and stage placement",
        ],
        "description": """Retractable roll-up banners are the workhorses of church interior signage. Set one up in your lobby to welcome first-time visitors. Place two flanking the stage to frame your sermon series artwork. Use them at the registration table for your next conference or VBS event.

The beauty of roll-up banners is their speed — pull up, lock in, you're done in under 30 seconds. They retract just as quickly and stow in a slim carry bag, making them ideal for churches that use the same space for multiple purposes or ministries that travel.

We offer 80cm and 85cm widths, both at 200cm height. Choose from economy stands for budget-conscious orders or luxury aluminum stands for a more premium presentation. Same-day production is available when you need it most.""",
        "use_cases": [
            ("🏛️", "Church lobby welcome displays"),
            ("🎤", "Stage & pulpit flanking"),
            ("📋", "Registration & check-in tables"),
            ("📅", "Sermon series promotions"),
            ("🎓", "Conference & summit signage"),
            ("🎄", "Seasonal event displays"),
        ],
        "sizes": ["80cm × 200cm", "85cm × 200cm"],
        "related": ["stage-backdrop-banner", "a-frame-popup-banner", "fabric-sanctuary-banner"],
    },
    {
        "slug": "stage-backdrop-banner",
        "image": "../images/backdrop.jpg",
        "badge": "Event Fave",
        "category": "Event Displays",
        "name": "Stage Backdrop Banner",
        "tagline": "Large-format fabric backdrops that transform your stage for any ministry event.",
        "scripture": "One thing I ask from the Lord... to dwell in the house of the Lord all the days of my life.",
        "scripture_ref": "Psalm 27:4",
        "specs": [
            ("Material", "Polyester Fabric"),
            ("Frame", "Aluminum alloy"),
            ("Standard Sizes", "8×8, 8×10, 10×10, 10×15, 10×20 ft"),
            ("Print", "Full-color, vibrant"),
            ("Setup", "Tool-free pop-up frame"),
            ("Includes", "Carry bag"),
        ],
        "features": [
            "Photo-perfect print quality for video and photography",
            "No wrinkles — fabric stretches taut over aluminum frame",
            "Pop-up frame sets up in minutes without tools",
            "Perfect for baptisms, weddings, and holiday services",
            "Sizes up to 10×20ft for large stages",
            "Includes heavy-duty carry bag for storage and travel",
        ],
        "description": """A stage backdrop banner instantly elevates the look of any event. Whether you're hosting a baptism service, a Christmas production, a wedding ceremony, or a multi-day conference, the backdrop is what appears in every photo and video frame — and it should look intentional.

Our backdrop banners are printed on smooth polyester fabric and mounted on an aluminum pop-up frame that sets up in minutes without any tools. The fabric pulls taut to eliminate wrinkles, giving you a clean, professional surface that photographs beautifully and looks great on camera.

Available from 8×8ft all the way up to 10×20ft, these backdrops can fill even the largest stages. Bring your custom design — sermon series artwork, church branding, scripture passages, or seasonal imagery — and we'll print it in full color.""",
        "use_cases": [
            ("💧", "Baptism ceremony backdrops"),
            ("💒", "Wedding & ceremony décor"),
            ("🎄", "Christmas & Easter productions"),
            ("📸", "Photo booth & media wall"),
            ("🎤", "Conference & summit staging"),
            ("📺", "Live stream backgrounds"),
        ],
        "sizes": ["8×8 ft", "8×10 ft", "10×10 ft", "10×15 ft", "10×20 ft"],
        "related": ["retractable-rollup-banner", "fabric-sanctuary-banner", "ministry-canopy-tent"],
    },
    {
        "slug": "ministry-canopy-tent",
        "image": "../images/canopy-tent.jpg",
        "badge": "Popular",
        "category": "Event Displays",
        "name": "Ministry Canopy Tent",
        "tagline": "Custom branded canopy tents for outdoor outreach, fairs, and community events.",
        "scripture": "Then the cloud covered the tent of meeting, and the glory of the Lord filled the tabernacle.",
        "scripture_ref": "Exodus 40:34",
        "specs": [
            ("Sizes", "10×10, 10×15, 10×20 ft"),
            ("Frame", "Aluminum alloy"),
            ("Canopy Material", "Polyester"),
            ("Print", "Full-color, all panels"),
            ("Setup", "Pop-up frame — no tools"),
            ("Includes", "Carry bag + stakes"),
        ],
        "features": [
            "Print your church name, logo, and branding on all panels",
            "Sturdy aluminum frame stands up in outdoor conditions",
            "Three size options: 10×10, 10×15, 10×20ft",
            "Full-color printing on roof, walls, and valances",
            "Removable sidewalls for versatile configurations",
            "Easy pop-up assembly — one person can set up in minutes",
        ],
        "description": """A branded canopy tent is your ministry's mobile billboard. Whether you're at a community fair, a block party, a farmers market, or a public outreach event, your tent is the first thing people see — and a fully branded tent tells them exactly who you are before you say a word.

Our aluminum-framed canopy tents are built for repeated outdoor use. The pop-up frame sets up quickly and holds firm in typical outdoor conditions. The polyester canopy and optional sidewalls can be printed in full color with your church name, logo, contact information, and even a scripture verse or welcoming message.

Three sizes are available to suit events of all scales — 10×10ft is perfect for a market stall or small presence, while 10×20ft gives you a full command post for larger events with room for tables, chairs, and materials.""",
        "use_cases": [
            ("🏘️", "Community fairs & festivals"),
            ("🤝", "Street outreach events"),
            ("🌾", "Farmers markets & expos"),
            ("🏃", "Sports & recreation events"),
            ("🍽️", "Church picnics & cookouts"),
            ("📋", "Voter registration & charity drives"),
        ],
        "sizes": ["10×10 ft", "10×15 ft", "10×20 ft"],
        "related": ["feather-teardrop-flag", "church-tablecloth", "custom-ministry-flag"],
    },
    {
        "slug": "a-frame-popup-banner",
        "image": "../images/popup-banner.jpg",
        "badge": "Portable",
        "category": "Event Displays",
        "name": "A-Frame Pop-Up Banner",
        "tagline": "Portable, attention-grabbing pop-up banners for lobbies, tables, and event spaces.",
        "scripture": "Go into all the world and preach the gospel to all creation.",
        "scripture_ref": "Mark 16:15",
        "specs": [
            ("Shapes", "Oval, Teardrop, Bean, Round"),
            ("Frame Material", "Fiberglass"),
            ("Banner Material", "Polyester"),
            ("Print", "Full-color"),
            ("Assembly", "Tool-free, under 60 seconds"),
            ("Portability", "Lightweight + carry bag"),
        ],
        "features": [
            "Four shape options: oval, teardrop, bean-shaped, round",
            "Lightweight fiberglass frame — easy to carry anywhere",
            "Full-color printing in your church branding",
            "Doubles as table display or freestanding banner",
            "Ideal for lobby, registration desk, or event entrance",
            "Assembles in under a minute without any tools",
        ],
        "description": """A-Frame pop-up banners offer maximum visual impact with minimum setup time. Their unique curved shapes — available in oval, teardrop, bean, and round — stand out from the rectangular banners that crowd most event spaces, drawing the eye naturally.

These are ideal for placing on or near tables at church events, flanking a registration desk, marking a welcoming area in your lobby, or guiding visitors at conferences. Their lightweight fiberglass frame makes them easy for volunteers to carry and position anywhere.

Each banner comes with a carry bag for storage and transport, making these a great investment for ministries that run regular events or outreach programs.""",
        "use_cases": [
            ("🏛️", "Lobby welcome & wayfinding"),
            ("📋", "Registration & info tables"),
            ("🎤", "Speaker introductions"),
            ("🎪", "Event booth identification"),
            ("🏫", "Church school & classrooms"),
            ("🌍", "Conference & summit displays"),
        ],
        "sizes": ["Small (2.8m)", "Medium (3.4m)", "Large (4m)", "Custom"],
        "related": ["retractable-rollup-banner", "ministry-canopy-tent", "stage-backdrop-banner"],
    },
    {
        "slug": "church-yard-sign",
        "image": "../images/yard-sign.jpg",
        "badge": "New",
        "category": "Signs & Signage",
        "name": "Church Yard Sign",
        "tagline": "Weatherproof corrugated plastic yard signs for service times, events, and outreach.",
        "scripture": "The Spirit of the Lord is on me, because He has anointed me to proclaim good news to the poor.",
        "scripture_ref": "Luke 4:18",
        "specs": [
            ("Material", "Corrugated Plastic (Coroplast)"),
            ("Weight", "1100gsm"),
            ("Thickness", "4.5mm"),
            ("UV Resistance", "12 months"),
            ("Shape", "Custom cut available"),
            ("Hardware", "Wire H-stake or Frame"),
        ],
        "features": [
            "Weatherproof — stands up to rain, heat, and cold",
            "12-month UV resistance keeps colors vibrant outdoors",
            "Custom cut shapes available — arrows, crosses, and more",
            "Wire H-stake included for easy lawn installation",
            "Lightweight and reusable season after season",
            "Ideal for temporary signage and event promotion",
        ],
        "description": """Church yard signs are one of the most cost-effective ways to communicate with your surrounding community. Place them along the street before a special service, along walkways to guide visitors, or in the yards of congregation members to spread the word about an upcoming revival or community event.

Made from 4.5mm thick corrugated plastic (commonly called Coroplast), these signs are weatherproof and lightweight. They come with wire H-stakes that push directly into the ground — no tools required. UV-resistant printing keeps your design sharp for up to 12 months outdoors.

We offer custom cut shapes alongside the standard rectangle — cross-shaped signs and directional arrows are popular choices for churches. Print is full-color on one or both sides.""",
        "use_cases": [
            ("📢", "Street-side service announcements"),
            ("🎉", "VBS and event promotion"),
            ("🤝", "Community outreach programs"),
            ("🎄", "Holiday service notifications"),
            ("📍", "Directional signage for events"),
            ("🏘️", "Member lawn displays"),
        ],
        "sizes": ["12×18 in", "18×24 in", "24×36 in", "Custom"],
        "related": ["church-vinyl-banner", "window-transfer-decal", "acrylic-pvc-sign"],
    },
    {
        "slug": "acrylic-pvc-sign",
        "image": "../images/acrylic-sign.jpg",
        "badge": "Premium",
        "category": "Signs & Signage",
        "name": "Acrylic & PVC Sign",
        "tagline": "Rigid, professional-grade signs for permanent church interior and exterior use.",
        "scripture": "Trust in the Lord with all your heart and lean not on your own understanding.",
        "scripture_ref": "Proverbs 3:5",
        "specs": [
            ("Materials", "PVC or Acrylic"),
            ("Thickness", "2mm – 20mm"),
            ("Print Method", "UV Printing"),
            ("Shape", "Any custom shape"),
            ("Finish", "Gloss or matte"),
            ("Mounting", "Standoffs, adhesive, or screws"),
        ],
        "features": [
            "Premium UV printing directly onto rigid material",
            "Available in PVC (budget) or Acrylic (premium clarity)",
            "Custom shapes — crosses, shields, arches, and more",
            "Thickness from 2mm to 20mm for any application",
            "Durable for permanent indoor and outdoor installation",
            "Professional standoff mounting hardware available",
        ],
        "description": """Acrylic and PVC signs bring a level of permanence and professionalism that fabric and paper simply can't match. These are the signs you install once and leave — on walls, doors, welcome desks, hallways, and exterior facades.

We print directly onto the rigid material using UV printing, which bonds ink permanently to the surface. PVC is our budget-friendly option — sturdy, lightweight, and suitable for most indoor applications. Acrylic offers a premium glass-like clarity and finish that looks exceptional as a lobby nameplate, directional sign, or decorative wall piece.

Both materials can be cut to custom shapes. Cross-shaped plaques, shield crests, arched nameplates, and rectangular directional signs are all achievable. Thickness ranges from 2mm to 20mm depending on your application and desired look.""",
        "use_cases": [
            ("🏛️", "Church name & address plaques"),
            ("🚪", "Room & ministry labels"),
            ("🤝", "Welcome desk nameplates"),
            ("📍", "Directional & wayfinding signs"),
            ("🏆", "Memorial & honor plaques"),
            ("📸", "Decorative scripture wall art"),
        ],
        "sizes": ["Custom — any size from 4×4 in to 4×8 ft"],
        "related": ["church-yard-sign", "window-transfer-decal", "floor-decal"],
    },
    {
        "slug": "church-vinyl-sticker",
        "image": "../images/sticker.jpg",
        "badge": "Giveaway Favorite",
        "category": "Stickers & Magnets",
        "name": "Church Vinyl Sticker",
        "tagline": "Custom die-cut stickers with crosses, scripture, and church logos — perfect for outreach and giveaways.",
        "scripture": "And we know that in all things God works for the good of those who love Him.",
        "scripture_ref": "Romans 8:28",
        "specs": [
            ("Material", "Vinyl"),
            ("Print", "Full-color"),
            ("Cut", "Custom die-cut or standard"),
            ("UV Resistance", "Yes"),
            ("Finish", "Gloss or matte"),
            ("Application", "Indoor & outdoor surfaces"),
        ],
        "features": [
            "Custom die-cut to any shape — crosses, doves, shields",
            "UV-resistant — suitable for outdoor use on cars and windows",
            "Full-color printing for vibrant religious designs",
            "Great for bulk giveaways at events and outreach",
            "Apply to Bibles, laptops, water bottles, car bumpers",
            "Minimum order quantities available for small ministries",
        ],
        "description": """Vinyl stickers are one of the most versatile and affordable outreach tools available. A well-designed sticker with your church logo, a memorable scripture, or a bold cross graphic becomes a mini billboard wherever it's placed — on a car bumper, a laptop, a water bottle, or a Bible cover.

Our stickers are printed in full color on durable UV-resistant vinyl, so they hold up outdoors without fading. Custom die-cutting lets us produce any shape you can imagine — a traditional cross, a descending dove, a shield, a fish symbol, or your church's custom emblem.

Stickers are extremely popular as giveaways at VBS, youth events, revivals, and community outreach programs. They're inexpensive enough to give away freely and impactful enough to leave a lasting impression.""",
        "use_cases": [
            ("🎁", "Event & VBS giveaways"),
            ("📖", "Bible & journal decoration"),
            ("🚗", "Car bumper & window stickers"),
            ("💻", "Laptop & device stickers"),
            ("🤝", "Outreach kits & welcome bags"),
            ("🏫", "Youth group merchandise"),
        ],
        "sizes": ["1×1 in", "2×2 in", "3×3 in", "4×4 in", "Custom"],
        "related": ["church-fridge-magnet", "magnetic-car-sign", "church-flyer-bulletin"],
    },
    {
        "slug": "window-transfer-decal",
        "image": "../images/window-decal.jpg",
        "badge": "Clean Look",
        "category": "Stickers & Magnets",
        "name": "Window Transfer Decal",
        "tagline": "Letter-only window decals that give your church a clean, professional storefront presence.",
        "scripture": "Whatever you do, whether in word or deed, do it all in the name of the Lord Jesus.",
        "scripture_ref": "Colossians 3:17",
        "specs": [
            ("Type", "Transfer vinyl — no background"),