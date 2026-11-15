/* ==========================================================================
   SPHEREx — Full-page ENG / MM translation engine
   - Translates every text node, placeholder, title and aria-label on the page
   - Re-translates content that page scripts insert dynamically (MutationObserver)
   - Translates canvas text (fillText), alert() and confirm() messages
   - Original English is always restored when switching back to ENG
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------ Exact phrases ------------------------------ */
  const D = {
    // Common / footer
    "SPHEREx": "SPHEREx",
    "© 2026 SPHEREx Mission Explorer. All rights reserved.": "© ၂၀၂၆ SPHEREx မစ်ရှင် စူးစမ်းလေ့လာရေး။ မူပိုင်ခွင့်အားလုံး ရယူထားသည်။",
    "Select Target": "ပစ်မှတ် ရွေးချယ်ရန်",
    "Cancel": "ပယ်ဖျက်မည်",
    "Querying...": "မေးမြန်းနေသည်...",

    // Explore
    "SPHEREx — Real-World IRSA Astronomical Sky Explorer": "SPHEREx — လက်တွေ့ IRSA ဗဟုသုတ ကောင်းကင်စူးစမ်းရေး",
    "CONNECTING TO IRSA TAP...": "IRSA TAP သို့ ချိတ်ဆက်နေသည်...",
    "REAL-TIME DATA": "တိုက်ရိုက်ဒေတာ",
    "Initializing Caltech/IPAC IRSA connection...": "Caltech/IPAC IRSA ချိတ်ဆက်မှု စတင်နေသည်...",
    "Downloading real SPHEREx Level 2 MEF FITS files & Astropy WCS...": "SPHEREx Level 2 MEF FITS ဖိုင်အစစ်များနှင့် Astropy WCS ကို ဒေါင်းလုဒ်လုပ်နေသည်...",
    "Coordinates (RA, Dec):": "ကိုဩဒိနိတ် (RA, Dec):",
    "Catalog Vectors (ON)": "ကတ်တလောက် ဗက်တာများ (ဖွင့်)",
    "Catalog Vectors (OFF)": "ကတ်တလောက် ဗက်တာများ (ပိတ်)",
    "102-Band Spectrum": "၁၀၂-လှိုင်းတန်း ရောင်စဉ်",
    "Barnard's Star (10.3\"/yr PM Star)": "ဘာနတ်၏ ကြယ် (တစ်နှစ်လျှင် ၁၀.၃″ ရွေ့လျားသောကြယ်)",
    "WISE 0855-0714 (Cold Brown Dwarf)": "WISE 0855-0714 (အေးသော ညိုဝါကြယ်ပု)",
    "Epsilon Indi B (Binary Brown Dwarf)": "အက်ပစီလွန် အင်ဒီ ဘီ (အမြွှာ ညိုဝါကြယ်ပု)",
    "RW Aurigae (T Tauri Star)": "RW အိုရီဂေး (တီ တောရီ ကြယ်)",
    "R Draconis (Mira Variable)": "R ဒရာကိုနစ် (မီရာ အလင်းပြောင်းကြယ်)",
    "Custom Celestial Coordinates...": "စိတ်ကြိုက် ကောင်းကင်ကိုဩဒိနိတ်...",
    "6-Month Survey Phase:": "၆ လတာ စစ်တမ်းအဆင့်:",
    "Vector Extrapolation:": "ဗက်တာ ခန့်မှန်းတွက်ချက်ချိန်:",
    "102-Band Spectrophotometry": "၁၀၂-လှိုင်းတန်း စပက်ထရိုဖိုတိုမက်ထရီ",
    "Target": "ပစ်မှတ်",
    ") — Real Photometry via Astropy": ") — Astropy ဖြင့် တိုင်းတာထားသော အစစ်အမှန် ဖိုတိုမက်ထရီ",
    "(High Proper-Motion Star)": "(ရွေ့လျားနှုန်းမြင့်ကြယ်)",
    "Highest known proper-motion star in the celestial sphere (10.3 arcsec/yr). Superb for verifying epoch difference dipoles and proper-motion displacement.": "ကောင်းကင်ပြင်တွင် ရွေ့လျားနှုန်း အမြင့်ဆုံးသိရှိထားသောကြယ် (တစ်နှစ်လျှင် ၁၀.၃ အာခ်စက္ကန့်)။ ကာလကွာခြားမှု ဒိုင်ပိုးများနှင့် ရွေ့လျားမှုနေရာပြောင်းလဲမှုကို စစ်ဆေးရန် အလွန်သင့်တော်သည်။",
    "Caltech/IPAC IRSA Level 2 Pipeline": "Caltech/IPAC IRSA Level 2 လုပ်ငန်းစဉ်",
    "TAP Table:": "TAP ဇယား:",
    "WCS Distortion:": "WCS ပုံပျက်မှု:",
    "North-Up TAN (6.2\"/px)": "မြောက်ဘက်အပေါ် TAN (၆.၂″/ပစ်ဇယ်)",
    "ZODI Model:": "ZODI မော်ဒယ်:",
    "Subtracted (HDU 4)": "နုတ်ပြီး (HDU 4)",
    "RA / Dec (ICRS)": "RA / Dec (ICRS)",
    "Gaia Sources": "Gaia အရင်းအမြစ်များ",
    "AllWISE Sources": "AllWISE အရင်းအမြစ်များ",
    "Proper Motion": "ရွေ့လျားနှုန်း",
    "Bandpass": "လှိုင်းတန်း",
    "Backend Pipeline": "နောက်ခံ လုပ်ငန်းစဉ်",
    "Live IRSA": "တိုက်ရိုက် IRSA",
    "Query Real Sky Patch from IRSA": "IRSA မှ ကောင်းကင်ပုံအစစ် ရယူရန်",
    "Enter Right Ascension and Declination to query live SPHEREx Level 2 FITS cutouts from NASA/IPAC IRSA TAP:": "NASA/IPAC IRSA TAP မှ SPHEREx Level 2 FITS ပုံများကို တိုက်ရိုက်ရယူရန် Right Ascension နှင့် Declination ကို ထည့်ပါ:",
    "RA (Degrees, 0 to 360):": "RA (ဒီဂရီ၊ ၀ မှ ၃၆၀):",
    "Dec (Degrees, -90 to +90):": "Dec (ဒီဂရီ၊ -၉၀ မှ +၉၀):",
    "Field of View (Degrees, 0.01 to 0.2):": "မြင်ကွင်းအကျယ် (ဒီဂရီ၊ ၀.၀၁ မှ ၀.၂):",
    "Fetch Live IRSA Cutouts": "တိုက်ရိုက် IRSA ပုံများ ရယူမည်",
    "e.g. 269.452075, 4.693391 (RA, Dec)": "ဥပမာ 269.452075, 4.693391 (RA, Dec)",
    "Celestial Coordinates RA and Dec": "ကောင်းကင်ကိုဩဒိနိတ် RA နှင့် Dec",
    "Explore coordinates via IRSA": "IRSA မှတစ်ဆင့် ကိုဩဒိနိတ်ကို လေ့လာမည်",
    "IRSA TAP querying & fetching FITS cutouts in parallel...": "IRSA TAP မေးမြန်းပြီး FITS ပုံများကို တစ်ပြိုင်နက် ရယူနေသည်...",
    "No Data in IRSA": "IRSA တွင် ဒေတာမရှိပါ",
    "Live IRSA (100% Real)": "တိုက်ရိုက် IRSA (၁၀၀% အစစ်အမှန်)",
    "Connection Error": "ချိတ်ဆက်မှု အမှား",
    "Extracting aperture photometry across SPHEREx MEF cutouts from IRSA...": "IRSA မှ SPHEREx MEF ပုံများပေါ်တွင် aperture ဖိုတိုမက်ထရီ ထုတ်ယူနေသည်...",
    "No non-zero flux measurements available in this FOV.": "ဤမြင်ကွင်းတွင် သုညမဟုတ်သော အလင်းတိုင်းတာမှု မရှိပါ။",
    "No SPHEREx Cutouts in IRSA Archive for this Sky Region": "ဤကောင်းကင်ဒေသအတွက် IRSA မော်ကွန်းတွင် SPHEREx ပုံများ မရှိပါ",
    "Try selecting Barnard's Star or WISE 0855 which have verified coverage in the current release.": "လက်ရှိထုတ်ပြန်မှုတွင် အတည်ပြုထားသော ဘာနတ်၏ကြယ် သို့မဟုတ် WISE 0855 ကို ရွေးကြည့်ပါ။",
    "Error Connecting to Backend / IRSA Pipeline": "နောက်ခံစနစ် / IRSA သို့ ချိတ်ဆက်ရာတွင် အမှားဖြစ်သည်",
    "Please enter valid numeric coordinates.": "မှန်ကန်သော ကိုဩဒိနိတ်ဂဏန်းများ ထည့်ပါ။",
    "Please enter valid coordinates as RA and Dec in degrees (e.g. 269.452075, 4.693391)": "RA နှင့် Dec ကို ဒီဂရီဖြင့် မှန်ကန်စွာ ထည့်ပါ (ဥပမာ 269.452075, 4.693391)",
    "Invalid celestial coordinates: RA must be between 0° and 360°, Dec between -90° and +90°.": "ကောင်းကင်ကိုဩဒိနိတ် မမှန်ပါ: RA သည် ၀° မှ ၃၆၀° ကြား၊ Dec သည် -၉၀° မှ +၉၀° ကြား ဖြစ်ရမည်။",
    "User-Defined Coordinate": "အသုံးပြုသူသတ်မှတ် ကိုဩဒိနိတ်",
    "User-Defined Celestial Coordinate": "အသုံးပြုသူသတ်မှတ် ကောင်းကင်ကိုဩဒိနိတ်",
    "Custom Celestial Target": "စိတ်ကြိုက် ကောင်းကင်ပစ်မှတ်",

    // Track
    "SPHEREx — Celestial Object Tracker & Nickname Studio": "SPHEREx — ကောင်းကင်ဝတ္ထု ခြေရာခံကိရိယာ",
    "CLICK ANY OBJECT ON CANVAS TO NAME & TRACK": "အမည်ပေးပြီး ခြေရာခံရန် ပုံပေါ်ရှိ ကောင်းကင်ဝတ္ထုကို နှိပ်ပါ",
    "TRACKING: ACTIVE": "ခြေရာခံမှု: လုပ်ဆောင်နေသည်",
    "Loading Multi-Epoch SPHEREx Cutouts...": "ကာလစုံ SPHEREx ပုံများ ဖွင့်နေသည်...",
    "Day-by-Day Blink": "နေ့စဉ် မှိတ်တုတ်ကြည့်ရန်",
    "Pause Blinker": "မှိတ်တုတ်ကြည့်ခြင်း ခေတ္တရပ်မည်",
    "Set Nickname": "အမည်ပေးမည်",
    "Motion Trajectory (ON)": "ရွေ့လျားလမ်းကြောင်း (ဖွင့်)",
    "Motion Trajectory (OFF)": "ရွေ့လျားလမ်းကြောင်း (ပိတ်)",
    "WISE 0855-0714 (Brown Dwarf Field)": "WISE 0855-0714 (ညိုဝါကြယ်ပု နယ်ပယ်)",
    "Barnard's Star (High PM Star Field)": "ဘာနတ်၏ ကြယ် (ရွေ့လျားနှုန်းမြင့်ကြယ် နယ်ပယ်)",
    "Epsilon Indi B (Binary Dwarf Field)": "အက်ပစီလွန် အင်ဒီ ဘီ (အမြွှာကြယ်ပု နယ်ပယ်)",
    "RW Aurigae (Dust Disk Variable Field)": "RW အိုရီဂေး (ဖုန်မှုန့်ချပ် အလင်းပြောင်းကြယ် နယ်ပယ်)",
    "R Draconis (Pulsating Giant Field)": "R ဒရာကိုနစ် (ခုန်လှုပ်ကြယ်ကြီး နယ်ပယ်)",
    "SPHEREx 6-Mo Survey Phase:": "SPHEREx ၆ လတာ စစ်တမ်းအဆင့်:",
    "Your Nicknamed Watchlist:": "သင်အမည်ပေးထားသော စောင့်ကြည့်စာရင်း:",
    "TRACKED OBJECT": "ခြေရာခံထားသော ကောင်းကင်ဝတ္ထု",
    "brown dwarf": "ညိုဝါကြယ်ပု",
    "Motion / Displacement": "ရွေ့လျားမှု / နေရာပြောင်းလဲမှု",
    "Moving (8,150 mas/yr)": "ရွေ့လျားနေသည် (8,150 mas/yr)",
    "Object shifts 1.3 px across observation baseline.": "လေ့လာချိန်အတွင်း ကောင်းကင်ဝတ္ထုသည် ၁.၃ ပစ်ဇယ် ရွေ့လျားသည်။",
    "Visibility & Flux Change": "မြင်နိုင်စွမ်းနှင့် အလင်းပြောင်းလဲမှု",
    "Visible & Stable": "မြင်ရပြီး တည်ငြိမ်သည်",
    "Flux variation within ±3.2% (No eclipse or disappearance).": "အလင်းပြောင်းလဲမှု ±၃.၂% အတွင်း (ကွယ်ခြင်း သို့မဟုတ် ပျောက်ကွယ်ခြင်း မရှိ)။",
    "Gas & Dust Obscuration": "ဓာတ်ငွေ့နှင့် ဖုန်မှုန့် ဖုံးကွယ်မှု",
    "Cold Atmosphere / Infrared Excess": "အေးသော လေထု / အင်ဖရားရက် ပိုလျှံမှု",
    "Strong infrared emission in Bands 5 & 6 (Sub-stellar methane/ice).": "Band 5 နှင့် 6 တွင် အင်ဖရားရက်ထုတ်လွှတ်မှု ပြင်းထန်သည် (ညိုဝါကြယ်ပု မီသိန်း/ရေခဲ)။",
    "SPHEREx 6-Month All-Sky Survey Passes:": "SPHEREx ၆ လတာ ကောင်းကင်တစ်ခုလုံး စစ်တမ်း ဖြတ်သန်းမှုများ:",
    "Survey Phase": "စစ်တမ်းအဆင့်",
    "UTC Calendar Date": "UTC ပြက္ခဒိန်ရက်စွဲ",
    "Band": "လှိုင်းတန်း",
    "Flux (μJy)": "အလင်းစီးဆင်းမှု (μJy)",
    "Detection": "ရှာဖွေတွေ့ရှိမှု",
    "View SED Spectrum": "SED ရောင်စဉ် ကြည့်မည်",
    "Untrack": "ခြေရာခံမှု ဖျက်မည်",
    "Name & Track Celestial Object": "ကောင်းကင်ဝတ္ထုကို အမည်ပေး၍ ခြေရာခံမည်",
    "Give a custom nickname to this star, brown dwarf, asteroid, or galaxy to track its position, brightness, and gas extinction day-by-day:": "ဤကြယ်၊ ညိုဝါကြယ်ပု၊ ဂြိုဟ်သိမ် သို့မဟုတ် ဂလက်ဆီ၏ တည်နေရာ၊ အလင်းနှင့် ဓာတ်ငွေ့ဖုံးကွယ်မှုကို နေ့စဉ်ခြေရာခံရန် စိတ်ကြိုက်အမည်ပေးပါ:",
    "Custom Nickname:": "စိတ်ကြိုက် အမည်:",
    "Classification Type:": "အမျိုးအစား ခွဲခြားမှု:",
    "Brown Dwarf / Sub-stellar": "ညိုဝါကြယ်ပု / ကြယ်မဖြစ်နိုင်သောအရာ",
    "Planet X / Trans-Neptunian Candidate": "ဂြိုဟ် X / နက်ပချွန်းကျော် ဖြစ်နိုင်ခြေရှိသည်",
    "High Proper-Motion Star": "ရွေ့လျားနှုန်းမြင့်ကြယ်",
    "Variable / Dimming Star": "အလင်းပြောင်းကြယ် / မှိန်သွားသောကြယ်",
    "Asteroid / Moving Body": "ဂြိုဟ်သိမ် / ရွေ့လျားသောအရာ",
    "Distant Galaxy / Quasar": "ဝေးကွာသော ဂလက်ဆီ / ကွာဆာ",
    "Notes / Hypothesis:": "မှတ်ချက် / ယူဆချက်:",
    "Save & Track": "သိမ်းဆည်း၍ ခြေရာခံမည်",
    "Select Celestial Field": "ကောင်းကင်နယ်ပယ် ရွေးချယ်ရန်",
    "e.g. brown dwarf, Planet X, Nemesis, Rogue Dwarf": "ဥပမာ ညိုဝါကြယ်ပု၊ ဂြိုဟ် X၊ နီမီစစ်၊ လမ်းလွဲကြယ်ပု",
    "e.g. Check if object dims in Survey 2 (+6m) epoch due to gas cloud": "ဥပမာ ဓာတ်ငွေ့တိမ်ကြောင့် စစ်တမ်း ၂ (+၆ လ) တွင် မှိန်သွားမသွား စစ်ဆေးရန်",
    "Please enter a nickname for the object.": "ကောင်းကင်ဝတ္ထုအတွက် အမည်တစ်ခု ထည့်ပါ။",
    "Insufficient Observations": "လေ့လာမှု မလုံလောက်ပါ",
    "Baseline Too Short (< 1.0 day)": "အချိန်ကာလ တိုလွန်းသည် (< ၁.၀ ရက်)",
    "Motion Not Computed": "ရွေ့လျားမှု မတွက်ချက်နိုင်ပါ",
    "Unable to compute reliable proper motion displacement from available epochs.": "ရရှိနိုင်သောကာလများမှ ယုံကြည်ရသော ရွေ့လျားမှု မတွက်ချက်နိုင်ပါ။",
    "Awaiting Multi-Epoch Data": "ကာလစုံဒေတာကို စောင့်ဆိုင်းနေသည်",
    "No scientific tracking measurements available for this coordinate.": "ဤကိုဩဒိနိတ်အတွက် သိပ္ပံနည်းကျ ခြေရာခံတိုင်းတာမှု မရှိပါ။",
    "Visible (Single Epoch per Band)": "မြင်ရသည် (လှိုင်းတန်းတစ်ခုလျှင် ကာလတစ်ခု)",
    "Source successfully identified in processed SPHEREx exposures.": "ပြုပြင်ထားသော SPHEREx ပုံများတွင် အရင်းအမြစ်ကို အောင်မြင်စွာ ဖော်ထုတ်နိုင်သည်။",
    "Below Detection Limit": "ရှာဖွေနိုင်သည့် ကန့်သတ်ချက်အောက်",
    "Target not detected above 3σ point-source noise threshold in these exposures.": "ဤပုံများတွင် 3σ ဆူညံသံ အတိုင်းအတာထက် ပစ်မှတ်ကို မတွေ့ရှိပါ။",
    "Methane / Ice Absorption Detected": "မီသိန်း / ရေခဲ စုပ်ယူမှု တွေ့ရှိသည်",
    "Strong infrared excess with H₂O ice and CH₄ absorption typical of cold sub-stellar atmosphere.": "အေးသော ညိုဝါကြယ်ပုလေထုတွင် ပုံမှန်တွေ့ရသည့် H₂O ရေခဲနှင့် CH₄ စုပ်ယူမှုနှင့်အတူ အင်ဖရားရက် ပြင်းထန်စွာ ပိုလျှံနေသည်။",
    "Circumstellar Dust Obscuration": "ကြယ်ပတ်လည် ဖုန်မှုန့် ဖုံးကွယ်မှု",
    "Episodic dimming and color reddening caused by dust clumps in circumstellar disk.": "ကြယ်ပတ်လည်ချပ်ရှိ ဖုန်မှုန့်အစုများကြောင့် ကာလအလိုက် မှိန်ကျပြီး အရောင် နီလာသည်။",
    "Circumstellar Molecular Envelope": "ကြယ်ပတ်လည် မော်လီကျူး အဖုံး",
    "Pulsating asymptotic giant branch star with silicate dust outflow and molecular gas bands.": "ဆီလီကိတ်ဖုန်မှုန့် ထွက်ရှိမှုနှင့် မော်လီကျူးဓာတ်ငွေ့ လှိုင်းတန်းများပါသော ခုန်လှုပ်နေသည့် AGB ကြယ်ကြီး။",
    "Optical / NIR Continuum": "မြင်လင်း / NIR ဆက်တိုက်ရောင်စဉ်",
    "Low interstellar extinction along line-of-sight.": "မြင်ကွင်းလမ်းကြောင်းတစ်လျှောက် ကြယ်ကြားဖုံးကွယ်မှု နည်းပါးသည်။",
    "No frame observations loaded.": "ဖရိမ်လေ့လာမှု မရှိသေးပါ။",
    "Detected": "တွေ့ရှိသည်",
    "Below Limit": "ကန့်သတ်ချက်အောက်",

    // Catalog
    "SPHEREx — Vector Field & Catalog Overlay (Gaia DR3 & AllWISE)": "SPHEREx — ဗက်တာနယ်ပယ်နှင့် ကတ်တလောက် ထပ်ပုံ (Gaia DR3 နှင့် AllWISE)",
    "Cross-matching Gaia DR3 & AllWISE via IRSA TAP...": "IRSA TAP မှတစ်ဆင့် Gaia DR3 နှင့် AllWISE ကို တိုက်ဆိုင်စစ်ဆေးနေသည်...",
    "Gaia DR3 (Optical)": "Gaia DR3 (မြင်လင်း)",
    "AllWISE (Infrared)": "AllWISE (အင်ဖရားရက်)",
    "Proper Motion Vectors": "ရွေ့လျားနှုန်း ဗက်တာများ",
    "Barnard's Star (10.3\"/yr)": "ဘာနတ်၏ ကြယ် (တစ်နှစ်လျှင် ၁၀.၃″)",
    "WISE 0855-0714 (Brown Dwarf)": "WISE 0855-0714 (ညိုဝါကြယ်ပု)",
    "Epsilon Indi B (Binary)": "အက်ပစီလွန် အင်ဒီ ဘီ (အမြွှာ)",
    "RW Aurigae (Variable)": "RW အိုရီဂေး (အလင်းပြောင်းကြယ်)",
    "R Draconis (AGB Giant)": "R ဒရာကိုနစ် (AGB ကြယ်ကြီး)",
    "Motion Baseline:": "ရွေ့လျားမှု အခြေခံကာလ:",
    "Multi-Mission Astrometry": "မစ်ရှင်စုံ နေရာတိုင်းတာမှု",
    "& Proper-Motion Vector Field.": "နှင့် ရွေ့လျားနှုန်း ဗက်တာနယ်ပယ်။",
    "Cross-matching Gaia DR3 optical astrometry with AllWISE mid-infrared photometry directly on the SPHEREx North-Up TAN WCS coordinate grid.": "Gaia DR3 မြင်လင်းနေရာတိုင်းတာမှုကို AllWISE အလယ်အင်ဖရားရက် ဖိုတိုမက်ထရီနှင့် SPHEREx မြောက်ဘက်အပေါ် TAN WCS ကိုဩဒိနိတ်ဇယားပေါ်တွင် တိုက်ရိုက်တိုက်ဆိုင်စစ်ဆေးသည်။",
    "Hover over any star marker...": "ကြယ်အမှတ်အသားပေါ် မောက်စ်တင်ကြည့်ပါ...",
    "Hover over cyan circles (Gaia DR3) or orange diamonds (AllWISE) to inspect parallax, magnitudes, and celestial motion vectors.": "ပါရလက်စ်၊ တောက်ပမှုနှင့် ရွေ့လျားမှုဗက်တာများကြည့်ရန် ပြာစိမ်းစက်ဝိုင်း (Gaia DR3) သို့မဟုတ် လိမ္မော်ရောင်စိန်ပုံ (AllWISE) ပေါ် မောက်စ်တင်ပါ။",
    "Hover over cyan circles (Gaia DR3) or orange diamonds (AllWISE) to inspect astrometry.": "နေရာတိုင်းတာမှုကြည့်ရန် ပြာစိမ်းစက်ဝိုင်း (Gaia DR3) သို့မဟုတ် လိမ္မော်ရောင်စိန်ပုံ (AllWISE) ပေါ် မောက်စ်တင်ပါ။",
    "Gaia DR3 Sources": "Gaia DR3 အရင်းအမြစ်များ",
    "Max Proper Motion": "အများဆုံး ရွေ့လျားနှုန်း",
    "Projection": "ပရိုဂျက်ရှင်း",
    "TAN (North-Up, East-Left)": "TAN (မြောက်အပေါ်၊ အရှေ့ဘယ်)",
    "No FITS Cutouts in IRSA Archive for this Sky Region": "ဤကောင်းကင်ဒေသအတွက် IRSA မော်ကွန်းတွင် FITS ပုံများ မရှိပါ",
    "Pipeline Error: Failed to Cross-Match Catalogs": "လုပ်ငန်းစဉ်အမှား: ကတ်တလောက်များ တိုက်ဆိုင်စစ်ဆေး၍မရပါ",

    // Spectrum
    "SPHEREx — 102-Band Spectrophotometry SED Viewer": "SPHEREx — ၁၀၂-လှိုင်းတန်း SED ကြည့်ရှုကိရိယာ",
    "102 BANDS • 6 DETECTORS": "၁၀၂ လှိုင်းတန်း • ဖမ်းယူကိရိယာ ၆ ခု",
    "Extracting 102-channel spectrophotometry...": "၁၀၂-ချန်နယ် စပက်ထရိုဖိုတိုမက်ထရီ ထုတ်ယူနေသည်...",
    // "3D Hyperspectral Cube (Three.js)": "၃ဒီ ဟိုက်ပါစပက်ထရယ် ကျူ့ဘ် (Three.js)",
    // "2D SED Chart": "၂ဒီ SED ဇယား",
    "Logarithmic Flux Scale": "လော်ဂရစ်သမ် အလင်းစီးဆင်းမှု စကေး",
    "Linear Flux Scale": "မျဥ်းဖြောင့် အလင်းစီးဆင်းမှု စကေး",
    "Molecular Absorption (H₂O, CO₂, CH₄)": "မော်လီကျူး စုပ်ယူမှု (H₂O, CO₂, CH₄)",
    "Hide Flagged Bad Pixels": "အမှတ်အသားပြထားသော ပျက်စီးပစ်ဇယ်များ ဝှက်မည်",
    "Epsilon Indi B (Binary T-Dwarf)": "အက်ပစီလွန် အင်ဒီ ဘီ (အမြွှာ T-ကြယ်ပု)",
    "Barnard's Star (M-Dwarf)": "ဘာနတ်၏ ကြယ် (M-ကြယ်ပု)",
    "RW Aurigae (T Tauri Disk)": "RW အိုရီဂေး (တီ တောရီ ချပ်)",
    "R Draconis (Mira Giant)": "R ဒရာကိုနစ် (မီရာ ကြယ်ကြီး)",
    "Hover along the spectrum to inspect individual spectrophotometric channels and SNR...": "ရောင်စဉ်တစ်လျှောက် မောက်စ်တင်၍ ချန်နယ်တစ်ခုချင်းနှင့် SNR ကို ကြည့်ပါ...",
    "102-Band SED": "၁၀၂-လှိုင်းတန်း SED",
    "synthesized via inverse-variance weighting.": "inverse-variance အလေးချိန်ဖြင့် ပေါင်းစပ်ထားသည်။",
    "SPHEREx uses 6 Linear Variable Filter (LVF) detector arrays to capture complete all-sky spectrophotometry from 0.75 μm to 5.00 μm. Photometric fluxes are converted from MJy/sr to μJy using exact pixel solid angle geometry with error propagation from VARIANCE HDUs.": "SPHEREx သည် Linear Variable Filter (LVF) ဖမ်းယူကိရိယာ ၆ ခုဖြင့် ၀.၇၅ μm မှ ၅.၀၀ μm အထိ ကောင်းကင်တစ်ခုလုံး စပက်ထရိုဖိုတိုမက်ထရီကို ရယူသည်။ ဖိုတိုမက်ထရစ်အလင်းစီးဆင်းမှုကို ပစ်ဇယ်ထုထည်ထောင့် ဂျီသြမေတြီအတိုင်း MJy/sr မှ μJy သို့ ပြောင်းလဲပြီး VARIANCE HDU များမှ အမှားဖြန့်ဝေမှုကို တွက်ချက်သည်။",
    "D1: 0.75-1.09 μm": "D1: ၀.၇၅-၁.၀၉ μm",
    "D2: 1.10-1.62 μm": "D2: ၁.၁၀-၁.၆၂ μm",
    "D3: 1.63-2.41 μm": "D3: ၁.၆၃-၂.၄၁ μm",
    "D4: 2.42-3.82 μm": "D4: ၂.၄၂-၃.၈၂ μm",
    "D5: 3.83-4.41 μm": "D5: ၃.၈၃-၄.၄၁ μm",
    "D6: 4.42-5.00 μm": "D6: ၄.၄၂-၅.၀၀ μm",
    "Covered Channels": "လွှမ်းခြုံထားသော ချန်နယ်များ",
    "Peak Flux": "အမြင့်ဆုံး အလင်းစီးဆင်းမှု",
    "1,240.5 μJy": "1,240.5 μJy",
    "Mean SNR": "ပျမ်းမျှ SNR",
    "Aperture Radius": "အဖွင့်အကျယ် အချင်းဝက်",
    "6.2 arcsec": "၆.၂ အာခ်စက္ကန့်",
    "Flux Density (μJy) [Log Scale]": "အလင်းသိပ်သည်းဆ (μJy) [လော်ဂရစ်သမ်]",
    "Flux Density (μJy) [Linear]": "အလင်းသိပ်သည်းဆ (μJy) [မျဥ်းဖြောင့်]",
    "Wavelength (μm) [SPHEREx 0.75 - 5.00 μm All-Sky Spectrophotometry]": "လှိုင်းအလျား (μm) [SPHEREx ၀.၇၅ - ၅.၀၀ μm ကောင်းကင်တစ်ခုလုံး စပက်ထရိုဖိုတိုမက်ထရီ]",
    "No active exposures in this sky region have been observed in these bands yet.": "ဤကောင်းကင်ဒေသတွင် ဤလှိုင်းတန်းများဖြင့် လေ့လာမှု မရှိသေးပါ။",
    "No FITS Cutouts in IRSA for Photometry Extraction": "ဖိုတိုမက်ထရီထုတ်ယူရန် IRSA တွင် FITS ပုံများ မရှိပါ",
    "Pipeline Error: Failed to Extract Photometry": "လုပ်ငန်းစဉ်အမှား: ဖိုတိုမက်ထရီ ထုတ်ယူ၍မရပါ",
    "CLEAN": "သန့်ရှင်း",
    "3D HYPERSPECTRAL CUBE (Three.js)": "၃ဒီ ဟိုက်ပါစပက်ထရယ် ကျူ့ဘ် (Three.js)",
    "Drag: Orbit/Rotate • Scroll: Zoom • Right-click: Pan": "ဆွဲ: လှည့်ပတ် • Scroll: ချဲ့/ချုံ့ • ညာနှိပ်: ရွှေ့",
    "No active SPHEREx exposures in this band yet": "ဤလှိုင်းတန်းတွင် SPHEREx လေ့လာမှု မရှိသေးပါ",

    // Diff
    "SPHEREx — Dipole Heatmap & Epoch Difference Inspector": "SPHEREx — ဒိုင်ပိုးအပူချိန်ပုံနှင့် ကာလကွာခြားမှု စစ်ဆေးကိရိယာ",
    "Computing Epoch B - Epoch A Differencing...": "ကာလ B - ကာလ A ကွာခြားမှုကို တွက်ချက်နေသည်...",
    "Dipole Heatmap (B - A)": "ဒိုင်ပိုး အပူချိန်ပုံ (B - A)",
    "Interactive Wipe Curtain ⇄": "အပြန်အလှန် Wipe ကာလများ ⇄",
    "Show Epoch B (Current)": "ကာလ B (လက်ရှိ) ပြမည်",
    "Show Epoch A (Past)": "ကာလ A (အတိတ်) ပြမည်",
    "Auto Same-Band": "အလိုအလျောက် လှိုင်းတန်းတူ",
    "Band 1 (0.75-1.09 μm)": "လှိုင်းတန်း ၁ (၀.၇၅-၁.၀၉ μm)",
    "Band 2 (1.10-1.62 μm)": "လှိုင်းတန်း ၂ (၁.၁၀-၁.၆၂ μm)",
    "Band 3 (1.63-2.41 μm)": "လှိုင်းတန်း ၃ (၁.၆၃-၂.၄၁ μm)",
    "Band 4 (2.42-3.82 μm)": "လှိုင်းတန်း ၄ (၂.၄၂-၃.၈၂ μm)",
    "Band 5 (3.83-4.41 μm)": "လှိုင်းတန်း ၅ (၃.၈၃-၄.၄၁ μm)",
    "Band 6 (4.42-5.00 μm)": "လှိုင်းတန်း ၆ (၄.၄၂-၅.၀၀ μm)",
    "Barnard's Star (Dipole Benchmark)": "ဘာနတ်၏ ကြယ် (ဒိုင်ပိုး စံနမူနာ)",
    "Epoch A ← Wipe Divider → Epoch B:": "ကာလ A ← Wipe ပိုင်းခြားမျဉ်း → ကာလ B:",
    "Epoch Differencing": "ကာလကွာခြားမှု နုတ်ယူခြင်း",
    "highlights proper-motion dipoles.": "ရွေ့လျားနှုန်း ဒိုင်ပိုးများကို ထင်ရှားစေသည်။",
    "Subtracting Epoch A from Epoch B cancels unmoving background stars. Fast-moving candidates leave a signature dipole: a negative blue trough at the previous position and a positive red peak at the new position.": "ကာလ B မှ ကာလ A ကို နုတ်လိုက်လျှင် မရွေ့လျားသော နောက်ခံကြယ်များ ပျောက်သွားသည်။ မြန်ဆန်စွာရွေ့လျားသော ကောင်းကင်ဝတ္ထုများသည် ဒိုင်ပိုးလက္ခဏာကို ချန်ထားသည် — အရင်နေရာတွင် အပြာရောင် အနုတ်ချိုင့်နှင့် နေရာအသစ်တွင် အနီရောင် အပေါင်းထိပ်။",
    "Positive Peak (New Position):": "အပေါင်းထိပ် (နေရာအသစ်):",
    "Negative Peak (Past Position):": "အနုတ်ထိပ် (အတိတ်နေရာ):",
    "Epoch A (Past)": "ကာလ A (အတိတ်)",
    "Epoch B (Recent)": "ကာလ B (လတ်တလော)",
    "Detector Array": "ဖမ်းယူကိရိယာ အစု",
    "Same-Band Match": "လှိုင်းတန်းတူ တိုက်ဆိုင်မှု",
    "Baseline Separation": "အခြေခံကာလ ခြားနားချက်",
    "Dipole Contrast": "ဒိုင်ပိုး ကွာခြားမှု",
    "Candidate Status": "ဖြစ်နိုင်ခြေ အခြေအနေ",
    "Awaiting Processing": "ပြုပြင်ခြင်းကို စောင့်ဆိုင်းနေသည်",
    "Select Detector Band": "ဖမ်းယူကိရိယာ လှိုင်းတန်း ရွေးချယ်ရန်",
    "Astropy same-band differencing complete. Decoding FITS frames...": "Astropy လှိုင်းတန်းတူ နုတ်ယူမှု ပြီးဆုံးပြီ။ FITS ဖရိမ်များကို ဖတ်နေသည်...",
    "Dipole Signal Detected": "ဒိုင်ပိုးအချက်ပြမှု တွေ့ရှိသည်",
    "Static / Negligible Residual": "မလှုပ်ရှား / ကျန်ရှိမှု အလွန်နည်း",
    "Differencing Failed": "ကွာခြားမှု တွက်ချက်၍ မရပါ",
    "Epoch A (Baseline Past)": "ကာလ A (အခြေခံ အတိတ်)",
    "Epoch B (Later Epoch)": "ကာလ B (နောက်ကာလ)",
    "(+) Positive Peak (Red): New Position (Epoch B)": "(+) အပေါင်းထိပ် (အနီ): နေရာအသစ် (ကာလ B)",
    "(-) Negative Trough (Blue): Past Position (Epoch A)": "(-) အနုတ်ချိုင့် (အပြာ): အတိတ်နေရာ (ကာလ A)",
    "No Multi-Epoch Cutouts Available for Differencing": "နုတ်ယူရန် ကာလစုံပုံများ မရှိပါ",
    "Scientific Differencing Constraint": "သိပ္ပံနည်းကျ နုတ်ယူမှု ကန့်သတ်ချက်",
    "Note: SPHEREx detectors have non-overlapping bands. Differencing requires at least 2 exposures in the same band.": "မှတ်ချက်: SPHEREx ဖမ်းယူကိရိယာများ၏ လှိုင်းတန်းများ မထပ်ပါ။ နုတ်ယူရန် လှိုင်းတန်းတစ်ခုတည်းတွင် အနည်းဆုံး ပုံ ၂ ပုံ လိုအပ်သည်။",

    // Presets
    "SPHEREx — Sky Navigator & Benchmark Presets": "SPHEREx — ကောင်းကင်လမ်းညွှန်နှင့် စံပစ်မှတ်များ",
    "ALL-SKY CELESTIAL PROJECTION (ICRS)": "ကောင်းကင်တစ်ခုလုံး ပရိုဂျက်ရှင်း (ICRS)",
    "5 OFFICIAL BENCHMARKS": "တရားဝင် စံပစ်မှတ် ၅ ခု",
    "Loading Benchmark Targets (/api/targets/presets)...": "စံပစ်မှတ်များ ဖွင့်နေသည် (/api/targets/presets)...",
    "Launch Blinker": "မှိတ်တုတ်ကြည့်ကိရိယာ စတင်မည်",
    "View Catalog Vectors": "ကတ်တလောက် ဗက်တာများ ကြည့်မည်",
    "Inspect Dipole Heatmap": "ဒိုင်ပိုး အပူချိန်ပုံ စစ်ဆေးမည်",
    "Planet X & SPHEREx": "ဂြိုဟ် X နှင့် SPHEREx",
    "Mission Benchmark Architecture.": "မစ်ရှင် စံပစ်မှတ် ဖွဲ့စည်းပုံ။",
    "The SPHEREx mission performs an all-sky spectroscopic survey across 102 infrared bands (0.75 to 5.00 μm). These 5 benchmark targets provide rigorous validation for high proper-motion tracking, sub-stellar brown dwarf detection, binary orbits, eruptive circumstellar dust disks, and long-period AGB stellar pulsations.": "SPHEREx မစ်ရှင်သည် အင်ဖရားရက်လှိုင်းတန်း ၁၀၂ ခု (၀.၇၅ မှ ၅.၀၀ μm) ဖြင့် ကောင်းကင်တစ်ခုလုံး ရောင်စဉ်ခွဲစစ်တမ်း ပြုလုပ်သည်။ ဤစံပစ်မှတ် ၅ ခုသည် ရွေ့လျားနှုန်းမြင့် ခြေရာခံမှု၊ ညိုဝါကြယ်ပု ရှာဖွေမှု၊ အမြွှာလှည့်ပတ်မှု၊ ဖုန်မှုန့်ချပ် ပေါက်ကွဲမှုနှင့် AGB ကြယ်ကြီးများ၏ ကာလရှည် ခုန်လှုပ်မှုများကို တိကျစွာ အတည်ပြုပေးသည်။",
    "WISE 0855-0714": "WISE 0855-0714",
    "Sub-stellar Brown Dwarf": "ညိုဝါကြယ်ပု",
    "Active Target RA": "လက်ရှိပစ်မှတ် RA",
    "Active Target Dec": "လက်ရှိပစ်မှတ် Dec",
    "Optimal Band": "အကောင်းဆုံး လှိုင်းတန်း",
    "Galactic Plane": "နဂါးငွေ့တန်း ပြင်ညီ",
    "Unknown Date": "မသိရသော ရက်စွဲ",
    "Unknown UTC": "မသိရသော UTC"
  };

  /* Preset target names / types / descriptions already have Myanmar versions */
  try {
    if (typeof BENCHMARK_PRESETS !== 'undefined') {
      BENCHMARK_PRESETS.forEach(p => {
        if (p.name && p.name_mm) D[p.name] = p.name_mm;
        if (p.type && p.type_mm) D[p.type] = p.type_mm;
        if (p.description && p.description_mm) D[p.description] = p.description_mm;
      });
    }
  } catch (e) { /* ignore */ }

  /* ----------------------- Dynamic patterns (numbers etc.) ----------------------- */
  const P = [
    [/^Measured Motion: (.+)$/, (m) => `တိုင်းတာထားသော ရွေ့လျားမှု: ${m[1]}`],
    [/^Displacement: (.+)″ \(~(.+) px\) over (.+) days baseline \(Confidence: (.+)%\)(.*)\.$/, (m) => `နေရာပြောင်းလဲမှု: ${m[1]}″ (~${m[2]} ပစ်ဇယ်) — အခြေခံကာလ ${m[3]} ရက်အတွင်း (ယုံကြည်မှု ${m[4]}%)${m[5]}။`],
    [/^Negligible Motion \((.+)\)$/, (m) => `ရွေ့လျားမှု အလွန်နည်း (${m[1]})`],
    [/^Position shifts < (.+)″ across (.+) days baseline\. Consistent with distant background star or galaxy\.$/, (m) => `ကာလ ${m[2]} ရက်အတွင်း တည်နေရာ ${m[1]}″ အောက်သာ ပြောင်းသည်။ ဝေးကွာသော နောက်ခံကြယ် သို့မဟုတ် ဂလက်ဆီနှင့် ကိုက်ညီသည်။`],
    [/^Source detected in only (\d+) of (\d+) frames\. At least 2 detections needed to compute displacement\.$/, (m) => `ဖရိမ် ${m[2]} ခုအနက် ${m[1]} ခုတွင်သာ တွေ့ရှိသည်။ နေရာပြောင်းလဲမှု တွက်ရန် အနည်းဆုံး ၂ ကြိမ် တွေ့ရှိရမည်။`],
    [/^Observations cover only (.+) days\. Long-term proper motion requires wider temporal baseline\.$/, (m) => `လေ့လာမှုသည် ${m[1]} ရက်သာ ကာလရှိသည်။ ကာလရှည် ရွေ့လျားနှုန်းအတွက် ပိုကျယ်သော အချိန်ကာလ လိုအပ်သည်။`],
    [/^Target Variable in (.+) \(ΔFlux: (.+)%\)$/, (m) => `${m[1]} တွင် ပစ်မှတ် အလင်းပြောင်းလဲသည် (Δအလင်း: ${m[2]}%)`],
    [/^Target aperture flux varies between (.+) and (.+) μJy across (\d+) epochs \(reduced χ² = (.+)\)\.$/, (m) => `ပစ်မှတ်၏ aperture အလင်းစီးဆင်းမှုသည် ကာလ ${m[3]} ခုအတွင်း ${m[1]} မှ ${m[2]} μJy ကြား ပြောင်းလဲသည် (reduced χ² = ${m[4]})။`],
    [/^Photometrically Stable in (.+)$/, (m) => `${m[1]} တွင် ဖိုတိုမက်ထရီအရ တည်ငြိမ်သည်`],
    [/^Target aperture flux stable within ±(.+)% across (\d+) epochs \(reduced χ² = (.+)\)\.$/, (m) => `ပစ်မှတ်၏ aperture အလင်းစီးဆင်းမှုသည် ကာလ ${m[2]} ခုအတွင်း ±${m[1]}% အတွင်း တည်ငြိမ်သည် (reduced χ² = ${m[3]})။`],
    [/^Detected in (\d+) frames across different detector bands\. Same-band temporal comparison pending\.$/, (m) => `ကွဲပြားသော ဖမ်းယူကိရိယာ လှိုင်းတန်းများရှိ ဖရိမ် ${m[1]} ခုတွင် တွေ့ရှိသည်။ လှိုင်းတန်းတူ ကာလနှိုင်းယှဉ်မှု စောင့်ဆိုင်းနေသည်။`],
    [/^Detected \((\d+)\/(\d+) Frames\)$/, (m) => `တွေ့ရှိသည် (ဖရိမ် ${m[1]}/${m[2]})`],
    [/^Detected \(SNR (.+)\)$/, (m) => `တွေ့ရှိသည် (SNR ${m[1]})`],
    [/^\(Below Limit in (.+)\)$/, (m) => `(${m[1]} တွင် ကန့်သတ်ချက်အောက်)`],
    [/^Pre-rendering (\d+) real FITS exposures onto WCS grid\.\.\.$/, (m) => `WCS ဇယားပေါ်သို့ FITS ပုံအစစ် ${m[1]} ပုံကို ကြိုတင်ဆွဲနေသည်...`],
    [/^Failed to extract spectrum: (.+)$/, (m) => `ရောင်စဉ် ထုတ်ယူ၍မရပါ: ${m[1]}`],
    [/^Untrack and remove "(.+)" from your watchlist\?$/, (m) => `"${m[1]}" ကို သင့်စောင့်ကြည့်စာရင်းမှ ခြေရာခံမှုဖျက်ပြီး ဖယ်ရှားမလား?`],
    [/^TARGET: (.+) \(0\.75 - 5\.00 μm\)$/, (m) => `ပစ်မှတ်: ${tr(m[1])} (၀.၇၅ - ၅.၀၀ μm)`],
    [/^(\d+) OBSERVED • (\d+) NOMINAL CHANNELS$/, (m) => `လေ့လာပြီး ${m[1]} • သတ်မှတ်ချန်နယ် ${m[2]}`],
    [/^SPHEREx Survey (.+?) • (.+)$/, (m) => `SPHEREx စစ်တမ်း ${m[1]} • ${monthFix(m[2])}`],
    [/^Survey (\d+) \((.+)\)$/, (m) => `စစ်တမ်း ${m[1]} (${monthFix(m[2])})`],
    [/^Survey (\d+) • (.+)$/, (m) => `စစ်တမ်း ${m[1]} • ${monthFix(m[2])}`],
    [/^(\d+) Years?$/, (m) => `${m[1]} နှစ်`],
    [/^(\d+) Years? Extrapolation$/, (m) => `${m[1]} နှစ် ခန့်မှန်းတွက်ချက်ချိန်`],
    [/^(.+) Days \(MJD Δ\)$/, (m) => `${m[1]} ရက် (MJD Δ)`],
    [/^(\d+)% Split$/, (m) => `${m[1]}% ခွဲခြား`],
    [/^Detector: (.+)$/, (m) => `ဖမ်းယူကိရိယာ: ${m[1]}`],
    [/^\(\+\) New #(\d+)$/, (m) => `(+) အသစ် #${m[1]}`],
    [/^\(-\) Old #(\d+)$/, (m) => `(-) အဟောင်း #${m[1]}`],
    [/^Designation: (.+)$/, (m) => `သတ်မှတ်အမည်: ${m[1]}`],
    [/^DIPOLE CONTRAST: (.+)$/, (m) => `ဒိုင်ပိုး ကွာခြားမှု: ${m[1]}`],
    [/^GAIA: (\d+) • ALLWISE: (\d+)$/, (m) => `GAIA: ${m[1]} • ALLWISE: ${m[2]}`],
    [/^Channel$/, () => 'ချန်နယ်'],
    [/^FLAGGED \((.*)\)$/, (m) => `အမှတ်အသားပြထား (${m[1]})`]
  ];

  /* Fallback word/phrase glossary (applied when no exact/pattern match) */
  const G = [
    ["Wipe Divider", "Wipe ပိုင်းခြားမျဉ်း"],
    ["exposures", "ပုံများ"], ["exposure", "ပုံ"],
    ["NOMINAL CHANNELS", "သတ်မှတ်ချန်နယ်များ"], ["OBSERVED", "လေ့လာပြီး"],
    ["Channel", "ချန်နယ်"], ["channel", "ချန်နယ်"],
    ["Status", "အခြေအနေ"], ["CLEAN", "သန့်ရှင်း"], ["FLAGGED", "အမှတ်အသားပြထား"],
    ["Flux", "အလင်းစီးဆင်းမှု"], ["SNR", "SNR"],
    ["Survey", "စစ်တမ်း"],
    ["Years", "နှစ်"], ["Year", "နှစ်"], ["Days", "ရက်"], ["Day", "ရက်"],
    ["Epoch", "ကာလ"],
    ["Detected", "တွေ့ရှိသည်"], ["Below Limit", "ကန့်သတ်ချက်အောက်"],
    ["Extrapolation", "ခန့်မှန်းတွက်ချက်ချိန်"],
    ["Pause Blinker", "မှိတ်တုတ်ကြည့်ခြင်း ခေတ္တရပ်မည်"],
    ["Day-by-Day Blink", "နေ့စဉ် မှိတ်တုတ်ကြည့်ရန်"],
    ["ON", "ဖွင့်"], ["OFF", "ပိတ်"]
  ].map(([k, v]) => [new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), v]);
  const MONTHS = [["Jan", "ဇန်နဝါရီ"], ["Feb", "ဖေဖော်ဝါရီ"], ["Mar", "မတ်"], ["Apr", "ဧပြီ"], ["May", "မေ"], ["Jun", "ဇွန်"],
  ["Jul", "ဇူလိုင်"], ["Aug", "ဩဂုတ်"], ["Sep", "စက်တင်ဘာ"], ["Oct", "အောက်တိုဘာ"], ["Nov", "နိုဝင်ဘာ"], ["Dec", "ဒီဇင်ဘာ"]]
    .map(([k, v]) => [new RegExp('\\b' + k + '\\b', 'g'), v]); function monthFix(s) { MONTHS.forEach(([r, v]) => { s = s.replace(r, v); }); return s; }

  /* --------------------------------- Core ---------------------------------- */
  const TRIM = /^[\s▷❚➔∿✕★⇄⌖]+|[\s▷❚➔∿✕★⇄⌖]+$/g;
  const cache = new Map();

  function tr(s) {
    if (!s || !/[A-Za-z]/.test(s)) return s;
    const norm = s.replace(/\s+/g, ' ').trim();
    if (cache.has(norm)) return restoreEdges(s, cache.get(norm));
    let out = lookup(norm);
    if (out === null) {
      const core = norm.replace(TRIM, '');
      if (core && core !== norm) {
        const inner = lookup(core);
        if (inner !== null) out = norm.replace(core, inner);
      }
    }
    if (out === null) {
      let g = norm;
      G.forEach(([r, v]) => { g = g.replace(r, v); });
      out = g !== norm ? g : norm;
    }
    cache.set(norm, out);
    return restoreEdges(s, out);
  }
  function lookup(norm) {
    if (Object.prototype.hasOwnProperty.call(D, norm)) return D[norm];
    for (const [re, fn] of P) {
      const m = norm.match(re);
      if (m) return fn(m);
    }
    return null;
  }
  function restoreEdges(orig, out) {
    const lead = (orig.match(/^\s*/) || [''])[0];
    const trail = (orig.match(/\s*$/) || [''])[0];
    return lead + out + trail;
  }

  /* --------------------------- DOM text translation --------------------------- */
  let lang = (typeof localStorage !== 'undefined' && localStorage.getItem('spherex_lang')) || 'en';
  const textRec = new WeakMap();   // text node -> {en, mm}
  const attrRec = new WeakMap();   // element -> {attr: {en, mm}}
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CANVAS: 1, NOSCRIPT: 1 };
  let busy = false;

  function doText(node) {
    const v = node.nodeValue;
    const rec = textRec.get(node);
    if (lang === 'mm') {
      if (rec && v === rec.mm) return;
      const mm = tr(v);
      if (mm !== v) { node.nodeValue = mm; textRec.set(node, { en: v, mm }); }
      else textRec.delete(node);
    } else if (rec && v === rec.mm) {
      node.nodeValue = rec.en;
      textRec.delete(node);
    }
  }
  function doAttrs(el) {
    let rec = attrRec.get(el);
    ATTRS.forEach(a => {
      if (!el.hasAttribute(a)) return;
      const v = el.getAttribute(a);
      const r = rec && rec[a];
      if (lang === 'mm') {
        if (r && v === r.mm) return;
        const mm = tr(v);
        if (mm !== v) {
          el.setAttribute(a, mm);
          if (!rec) { rec = {}; attrRec.set(el, rec); }
          rec[a] = { en: v, mm };
        }
      } else if (r && v === r.mm) {
        el.setAttribute(a, r.en);
        delete rec[a];
      }
    });
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!SKIP[root.parentNode && root.parentNode.nodeName]) doText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    doAttrs(root);
    for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  }

  let titleEn = null;
  function doTitle() {
    if (titleEn === null) titleEn = document.title;
    document.title = lang === 'mm' ? tr(titleEn) : titleEn;
  }

  const observer = new MutationObserver((muts) => {
    if (busy) return;
    busy = true;
    try {
      muts.forEach(m => {
        if (m.type === 'characterData') {
          const p = m.target.parentNode;
          if (p && !SKIP[p.nodeName]) doText(m.target);
        } else if (m.type === 'childList') {
          m.addedNodes.forEach(n => walk(n));
        } else if (m.type === 'attributes') {
          doAttrs(m.target);
        }
      });
    } finally { busy = false; }
  });

  function startObserver() {
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function apply(newLang) {
    lang = newLang === 'mm' ? 'mm' : 'en';
    if (!document.body) return;
    busy = true;
    try { walk(document.body); doTitle(); } finally { busy = false; }
    // Let pages redraw their canvases with the new language
    try { document.dispatchEvent(new CustomEvent('spherex-lang-change', { detail: lang })); } catch (e) { /* ignore */ }
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
  }

  /* ------------------------ Canvas text, alert and confirm ------------------------ */
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (proto) {
    ['fillText', 'strokeText'].forEach(fn => {
      const orig = proto[fn];
      proto[fn] = function (text, ...rest) {
        return orig.call(this, lang === 'mm' && typeof text === 'string' ? tr(text) : text, ...rest);
      };
    });
  }
  const _alert = window.alert.bind(window);
  window.alert = (msg) => _alert(lang === 'mm' ? tr(String(msg)) : msg);
  const _confirm = window.confirm.bind(window);
  window.confirm = (msg) => _confirm(lang === 'mm' ? tr(String(msg)) : msg);

  window.SXTranslate = { apply, tr, get lang() { return lang; } };

  document.addEventListener('DOMContentLoaded', () => {
    startObserver();
    apply(lang);
  });
})();
