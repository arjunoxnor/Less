/**
 * Fixed SmartType catalogs, the way Final Draft and Arc Studio offer them. These
 * are the standard, learnable vocabularies of professional formatting; the live
 * outline supplies the script-specific ones (characters, locations, times).
 *
 * House rules hold in every string: no em dashes, no emojis, no exclamation
 * marks. "FADE OUT." ends in a period because that is the correct transition.
 */

/** Character cue extensions, offered after a name once you type "(". */
export const CHARACTER_EXTENSIONS: readonly string[] = [
  "(V.O.)",
  "(O.S.)",
  "(O.C.)",
  "(CONT'D)",
  "(PRELAP)",
  "(INTO PHONE)",
  "(ON PHONE)",
  "(FILTERED)",
  "(SUBTITLE)",
];

/** Plain-English glosses for the common extensions, shown as the dropdown hint. */
export const EXTENSION_HINTS: Record<string, string> = {
  "(V.O.)": "voice over",
  "(O.S.)": "off screen",
  "(O.C.)": "off camera",
  "(CONT'D)": "continuing",
};

/** Standard scene transitions, offered on a transition line. */
export const TRANSITIONS: readonly string[] = [
  "CUT TO:",
  "DISSOLVE TO:",
  "SMASH CUT TO:",
  "MATCH CUT TO:",
  "JUMP CUT TO:",
  "TIME CUT:",
  "INTERCUT WITH:",
  "FADE IN:",
  "FADE OUT.",
  "FADE TO BLACK.",
  "FADE TO WHITE.",
  "DISSOLVE:",
  "QUICK CUT TO:",
  "BACK TO:",
  "WIPE TO:",
];

/** Camera and shot slugs, offered on an action line typed in all caps. */
export const SHOTS: readonly string[] = [
  "ANGLE ON",
  "CLOSE ON",
  "CLOSE-UP",
  "EXTREME CLOSE-UP",
  "WIDE",
  "WIDE SHOT",
  "INSERT",
  "POV",
  "REVERSE ANGLE",
  "TWO SHOT",
  "AERIAL SHOT",
  "ESTABLISHING SHOT",
  "BACK TO SCENE",
  "UNDERWATER",
];

/** Common interior sub-locations, offered after the dash in a slugline. */
export const COMMON_SUBLOCATIONS: readonly string[] = [
  "KITCHEN",
  "BEDROOM",
  "BATHROOM",
  "LIVING ROOM",
  "HALLWAY",
  "OFFICE",
  "GARAGE",
  "BASEMENT",
  "ATTIC",
  "ENTRYWAY",
  "STAIRCASE",
  "ROOFTOP",
  "PARKING LOT",
  "LOBBY",
  "ELEVATOR",
];

/** The longest catalog entry on an action line, used to short-circuit the gate. */
export const LONGEST_ACTION_CANDIDATE = Math.max(
  ...SHOTS.map((s) => s.length),
  ...TRANSITIONS.map((t) => t.length)
);
