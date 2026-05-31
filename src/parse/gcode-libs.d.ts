// Ambient type declarations for the untyped cncjs G-code library. Only the
// slice of the API that the parse core relies on is declared.

declare module 'gcode-toolpath' {
  export interface ToolpathVec3 {
    x: number;
    y: number;
    z: number;
  }
  export interface ToolpathModal {
    motion: string; // 'G0' | 'G1' | 'G2' | 'G3' | …
    units: string; // 'G20' | 'G21'
    distance: string; // 'G90' | 'G91'
    spindle: string; // 'M3' | 'M4' | 'M5'
    tool: number;
    [key: string]: unknown;
  }
  export interface ToolpathOptions {
    position?: Partial<ToolpathVec3>;
    modal?: Partial<ToolpathModal>;
    addLine?: (modal: ToolpathModal, v1: ToolpathVec3, v2: ToolpathVec3) => void;
    addArcCurve?: (
      modal: ToolpathModal,
      v1: ToolpathVec3,
      v2: ToolpathVec3,
      v0: ToolpathVec3,
    ) => void;
  }
  export default class Toolpath {
    constructor(options?: ToolpathOptions);
    loadFromStringSync(
      str: string,
      callback?: (data: unknown, index: number) => void,
    ): unknown[];
  }
}
