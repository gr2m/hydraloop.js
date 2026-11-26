// Links functional components from the troubleshooting catalogue to geometry
// in the H600 V2.1 CAD export. The CAD export is a simplified collection model:
// it contains tanks, plumbing, covers and the ECU housing, but not pumps,
// UV units, valves internals, boards or tubing. `fidelity` makes that explicit.
//
// Targets are HYD part numbers. A target matches a solid when it equals the
// solid's own part number, its sub-assembly part number, or its top-level
// assembly part number.

export type Fidelity =
  /** The highlighted geometry is this component. */
  | "modeled"
  /** Not modeled separately; it sits inside or on the highlighted assembly per the CAD tree. */
  | "housing"
  /** Not modeled; the highlighted area is an inferred, approximate location. */
  | "approximate"
  /** Site equipment outside the unit; the highlighted geometry is where it connects. */
  | "external"
  /** Not modeled and no location is given in the sources. */
  | "none";

export interface ComponentMapping {
  fidelity: Fidelity;
  targets: string[];
  note?: string;
}

const T1 = "HYD1037";
const T2 = "HYD0064";
const T3 = "HYD1031";
const INLET = "HYD1020";
const MOTOR_VALVE = "HYD0992";
const DISTRIBUTION = "HYD0969";
const SOLENOID_MODULE = "HYD0967";
const OUTLETS = "HYD0441";
const ECU = "HYD1007";
const WASTE_OUTLET = "HYD1127";
const OVERFLOW = "HYD0386";

export const MAPPING: Record<string, ComponentMapping> = {
  BIO: {
    fidelity: "housing",
    targets: ["HYD0004", T2],
    note: "Biological film that grows inside the T1 and T2 cleaning tanks of both treatment sides.",
  },
  DIFF: {
    fidelity: "approximate",
    targets: ["HYD1085", "HYD1107"],
    note: "Shown at the aerator ring connections on the T1 assemblies. The diffuser itself is not modeled.",
  },
  T1: {
    fidelity: "modeled",
    targets: ["HYD0004", "HYD0028", "HYD0155"],
    note: "The H600 has two T1 tanks, one per treatment side.",
  },
  T2: {
    fidelity: "modeled",
    targets: [T2],
    note: "The H600 has two T2 tanks, one per treatment side.",
  },
  T3: { fidelity: "modeled", targets: [T3] },
  T4: {
    fidelity: "none",
    targets: [],
    note: "The backup-water tank is not a separate body in the CAD export.",
  },
  T1T2_BENDS: {
    fidelity: "modeled",
    targets: ["HYD0312"],
    note: "Black Wafix PP 88.5° elbows on each T1 assembly.",
  },
  TRANSFER_TUBE: {
    fidelity: "none",
    targets: [],
    note: "Transfer tubing is not part of the CAD export.",
  },

  INLET: {
    fidelity: "modeled",
    targets: [INLET],
    note: "Drawing item 2 and 3: inlet manifold with 50 mm inside-diameter inlet.",
  },
  INLET_BYPASS: {
    fidelity: "approximate",
    targets: [MOTOR_VALVE],
    note: "The bypass valve sits on top of the device. The CAD export shows the two 2-way motor valves (DN 32) of the inlet manifold there; which one acts as bypass is not stated.",
  },
  INLET_MANIFOLD: {
    fidelity: "external",
    targets: ["HYD1004"],
    note: "Household greywater pipework connects at the inlet Y-piece.",
  },
  INLET_LIFT: {
    fidelity: "external",
    targets: ["HYD1004"],
    note: "Optional site equipment upstream of the inlet.",
  },
  INLET_CHECK: {
    fidelity: "external",
    targets: ["HYD1004"],
    note: "Optional site equipment upstream of the inlet.",
  },
  PREBUFFER: {
    fidelity: "external",
    targets: ["HYD1004"],
    note: "Optional site equipment upstream of the inlet.",
  },

  DIST_PUMP: {
    fidelity: "housing",
    targets: [DISTRIBUTION],
    note: "Part of the distribution module; the pump body is not modeled.",
  },
  DIST_CHECK: {
    fidelity: "housing",
    targets: [DISTRIBUTION],
    note: "Part of the distribution module; not modeled separately.",
  },
  PRESS_WCWM: {
    fidelity: "housing",
    targets: [DISTRIBUTION],
    note: "Part of the distribution module; not modeled separately.",
  },
  WC_OUT: {
    fidelity: "housing",
    targets: [OUTLETS],
    note: 'One of the G 1/2" outlets (drawing items 6 to 8). The export does not label which outlet is which.',
  },
  WM_OUT: {
    fidelity: "housing",
    targets: [OUTLETS],
    note: 'One of the G 1/2" outlets (drawing items 6 to 8). The export does not label which outlet is which.',
  },
  AUX_OUT: {
    fidelity: "housing",
    targets: [OUTLETS],
    note: 'One of the G 1/2" outlets (drawing items 6 to 8). The export does not label which outlet is which.',
  },
  AUX_FLOAT: {
    fidelity: "external",
    targets: [OUTLETS],
    note: "External reservoir equipment, fed from the outlets.",
  },
  TOILET: {
    fidelity: "external",
    targets: [OUTLETS],
    note: "Toilet plumbing, fed from the outlets.",
  },
  OUTLET_PIPES: {
    fidelity: "external",
    targets: [OUTLETS],
    note: "Site pipework connected to the outlets.",
  },
  BACKUP_SUPPLY: {
    fidelity: "external",
    targets: [DISTRIBUTION],
    note: 'Mains water connects to the distribution module (drawing item 9, G 1/2" male).',
  },
  BACKUP_VALVE: {
    fidelity: "housing",
    targets: [DISTRIBUTION],
    note: "Part of the distribution module; not modeled separately.",
  },

  X6: {
    fidelity: "none",
    targets: [],
    note: "Transfer valve for H600 side A. Not part of the CAD export.",
  },
  X42: {
    fidelity: "none",
    targets: [],
    note: "Transfer valve for H600 side B. Not part of the CAD export.",
  },
  X10: {
    fidelity: "housing",
    targets: [SOLENOID_MODULE],
    note: "Solenoid valves belong to the solenoid module of the distribution module; valve bodies are not modeled.",
  },
  X12: {
    fidelity: "housing",
    targets: [SOLENOID_MODULE],
    note: "Solenoid valves belong to the solenoid module of the distribution module; valve bodies are not modeled.",
  },
  SOLENOID_INSIDE: {
    fidelity: "housing",
    targets: [SOLENOID_MODULE],
    note: "Inside the solenoid valves of the solenoid module.",
  },

  UV_V1: {
    fidelity: "none",
    targets: [],
    note: "The UV unit is not part of the CAD export.",
  },
  UV_V2: {
    fidelity: "none",
    targets: [],
    note: "The UV unit is not part of the CAD export.",
  },
  UV_BALLAST: {
    fidelity: "none",
    targets: [],
    note: "Not part of the CAD export.",
  },
  UV_SENSOR: {
    fidelity: "none",
    targets: [],
    note: "Not part of the CAD export.",
  },
  UV_PATH: {
    fidelity: "none",
    targets: [],
    note: "Not part of the CAD export.",
  },
  CIRC_HOSES: {
    fidelity: "none",
    targets: [],
    note: "Internal tubing is not part of the CAD export.",
  },

  ELECTRIC_WIRING: {
    fidelity: "approximate",
    targets: ["HYD0723", "HYD0201"],
    note: "Shown at the ECU PCB connector and the front plate earth cable. Wiring runs are not modeled.",
  },
  IO_BOARD: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly. The board itself is not modeled.",
  },
  ECU: {
    fidelity: "modeled",
    targets: [ECU, "HYD0984"],
    note: "ECU base plate, connectors and fuses, under the ECU top cover.",
  },
  PRESS_BOARD: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly. The board itself is not modeled.",
  },

  T3_SENSOR_TUBE: {
    fidelity: "approximate",
    targets: [T3],
    note: "Connected to T3. The tube is not modeled.",
  },
  T3_COUPLINGS: {
    fidelity: "approximate",
    targets: [T3],
    note: "Connected to T3. The couplings are not modeled.",
  },

  T1_WASTE: {
    fidelity: "approximate",
    targets: [WASTE_OUTLET],
    note: "Drains through the waste-water outlet (drawing item 5). The valve is not modeled.",
  },
  T3_WASTE: {
    fidelity: "approximate",
    targets: [WASTE_OUTLET],
    note: "Drains through the waste-water outlet (drawing item 5). The valve is not modeled.",
  },
  T1_UBEND: {
    fidelity: "approximate",
    targets: [OVERFLOW],
    note: "Shown at the T1 overflow and drain fittings (45° PVC bend, reducer, check valve).",
  },
  SEWER: {
    fidelity: "external",
    targets: [WASTE_OUTLET],
    note: "Connects at the 40 mm waste-water outlet.",
  },
  SEWER_VENT: {
    fidelity: "external",
    targets: [WASTE_OUTLET],
    note: "Downstream of the 40 mm waste-water outlet.",
  },
  OUTLET_LIFT: {
    fidelity: "external",
    targets: [WASTE_OUTLET],
    note: "Optional site equipment downstream of the waste-water outlet.",
  },

  WIFI: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly.",
  },
  ROUTER: {
    fidelity: "external",
    targets: [],
    note: "Home network equipment, not part of the unit.",
  },
  POWER: {
    fidelity: "modeled",
    targets: ["HYD0477", "HYD0718", "HYD0720"],
    note: "C14 power inlet with switch and T3.15A fuses (drawing item 1).",
  },
  BATTERY: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly. Batteries are not modeled.",
  },
  BATTERY_LEAD: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly. Not modeled.",
  },
  BUZZER: {
    fidelity: "approximate",
    targets: [ECU],
    note: "Shown at the ECU assembly. Not modeled.",
  },
  BUZZER_OBSTR: {
    fidelity: "approximate",
    targets: ["HYD0984"],
    note: "Shown at the ECU top cover.",
  },
  AIR_CIRCUIT: {
    fidelity: "none",
    targets: [],
    note: "The source does not identify which air component is involved.",
  },
  DEVICE: {
    fidelity: "modeled",
    targets: ["HYD0950"],
    note: "The whole unit.",
  },
};

export const FIDELITY_LABEL: Record<Fidelity, string> = {
  modeled: "Modeled",
  housing: "Inside highlighted assembly",
  approximate: "Approximate location",
  external: "Outside the unit, connects here",
  none: "Not in 3D model",
};
