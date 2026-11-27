/**
 * Fixed-point trigonometry for derived geometry.
 *
 * NDC-1.0 keeps floating-point trigonometry off the calculation path. Angles stay integer
 * micro-degrees and sines come back as integer micro-units (1e6 = 1.0), so a pitch produces
 * the same run and rise on every platform and in every runtime.
 *
 * The table is a constant: sin(0..90°) at quarter-degree steps, with linear interpolation
 * between entries (worst-case error ~2e-6, which is 0.05 mm over a 20 m slope). It was
 * generated once with `python3 -c "import math; [round(math.sin(math.radians(k*0.25))*1e6) ...]"`
 * and is checked against the double-precision values in `trig.test.ts`.
 */
import { NumericError, mulDivRound } from './units';

export const MICRO_UNIT = 1_000_000;
export const QUARTER_TURN_MICRODEG = 90_000_000;

const STEP_MICRODEG = 250_000;

const SINE_TABLE: readonly number[] = [
        0,    4363,    8727,   13090,   17452,   21815,   26177,   30539,   34899,   39260,
    43619,   47978,   52336,   56693,   61049,   65403,   69756,   74108,   78459,   82808,
    87156,   91502,   95846,  100188,  104528,  108867,  113203,  117537,  121869,  126199,
   130526,  134851,  139173,  143493,  147809,  152123,  156434,  160743,  165048,  169350,
   173648,  177944,  182236,  186524,  190809,  195090,  199368,  203642,  207912,  212178,
   216440,  220697,  224951,  229200,  233445,  237686,  241922,  246153,  250380,  254602,
   258819,  263031,  267238,  271440,  275637,  279829,  284015,  288196,  292372,  296542,
   300706,  304864,  309017,  313164,  317305,  321439,  325568,  329691,  333807,  337917,
   342020,  346117,  350207,  354291,  358368,  362438,  366501,  370557,  374607,  378649,
   382683,  386711,  390731,  394744,  398749,  402747,  406737,  410719,  414693,  418660,
   422618,  426569,  430511,  434445,  438371,  442289,  446198,  450098,  453990,  457874,
   461749,  465615,  469472,  473320,  477159,  480989,  484810,  488621,  492424,  496217,
   500000,  503774,  507538,  511293,  515038,  518773,  522499,  526214,  529919,  533615,
   537300,  540974,  544639,  548293,  551937,  555570,  559193,  562805,  566406,  569997,
   573576,  577145,  580703,  584250,  587785,  591310,  594823,  598325,  601815,  605294,
   608761,  612217,  615661,  619094,  622515,  625923,  629320,  632705,  636078,  639439,
   642788,  646124,  649448,  652760,  656059,  659346,  662620,  665882,  669131,  672367,
   675590,  678801,  681998,  685183,  688355,  691513,  694658,  697790,  700909,  704015,
   707107,  710185,  713250,  716302,  719340,  722364,  725374,  728371,  731354,  734323,
   737277,  740218,  743145,  746057,  748956,  751840,  754710,  757565,  760406,  763232,
   766044,  768842,  771625,  774393,  777146,  779884,  782608,  785317,  788011,  790690,
   793353,  796002,  798636,  801254,  803857,  806445,  809017,  811574,  814116,  816642,
   819152,  821647,  824126,  826590,  829038,  831470,  833886,  836286,  838671,  841039,
   843391,  845728,  848048,  850352,  852640,  854912,  857167,  859406,  861629,  863836,
   866025,  868199,  870356,  872496,  874620,  876727,  878817,  880891,  882948,  884988,
   887011,  889017,  891007,  892979,  894934,  896873,  898794,  900698,  902585,  904455,
   906308,  908143,  909961,  911762,  913545,  915311,  917060,  918791,  920505,  922201,
   923880,  925541,  927184,  928810,  930418,  932008,  933580,  935135,  936672,  938191,
   939693,  941176,  942641,  944089,  945519,  946930,  948324,  949699,  951057,  952396,
   953717,  955020,  956305,  957571,  958820,  960050,  961262,  962455,  963630,  964787,
   965926,  967046,  968148,  969231,  970296,  971342,  972370,  973379,  974370,  975342,
   976296,  977231,  978148,  979045,  979925,  980785,  981627,  982450,  983255,  984041,
   984808,  985556,  986286,  986996,  987688,  988362,  989016,  989651,  990268,  990866,
   991445,  992005,  992546,  993068,  993572,  994056,  994522,  994969,  995396,  995805,
   996195,  996566,  996917,  997250,  997564,  997859,  998135,  998392,  998630,  998848,
   999048,  999229,  999391,  999534,  999657,  999762,  999848,  999914,  999962,  999990,
  1000000,
];

function sineMicro(angleMicrodeg: number): number {
  if (!Number.isInteger(angleMicrodeg)) {
    throw new NumericError('INPUT_OUT_OF_RANGE', 'angle must be whole micro-degrees');
  }
  if (angleMicrodeg < 0 || angleMicrodeg > QUARTER_TURN_MICRODEG) {
    throw new NumericError('PITCH_NOT_SUPPORTED', 'angle must be between 0 and 90 degrees');
  }
  const index = Math.floor(angleMicrodeg / STEP_MICRODEG);
  if (index >= SINE_TABLE.length - 1) return SINE_TABLE[SINE_TABLE.length - 1];
  const remainder = angleMicrodeg - index * STEP_MICRODEG;
  const low = SINE_TABLE[index];
  const high = SINE_TABLE[index + 1];
  return low + mulDivRound(high - low, remainder, STEP_MICRODEG);
}

/** sin(angle) in micro-units. */
export function sinMicro(angleMicrodeg: number): number {
  return sineMicro(angleMicrodeg);
}

/** cos(angle) in micro-units. */
export function cosMicro(angleMicrodeg: number): number {
  return sineMicro(QUARTER_TURN_MICRODEG - angleMicrodeg);
}

/** tan(angle) in micro-units, or null at 90° where it is unbounded. */
export function tanMicro(angleMicrodeg: number): number | null {
  const cosine = cosMicro(angleMicrodeg);
  if (cosine <= 0) return null;
  return mulDivRound(sinMicro(angleMicrodeg), MICRO_UNIT, cosine);
}
